// Looty — database behaviour tests.
//
// Runs the migrations against an in-process Postgres (pglite) and asserts the
// rules that must never regress: the domain fast path, username cadence, tier
// promotion, ban collapse, and — most importantly — that a client cannot promote
// itself or read private columns.
//
// No Docker required:  npm run test:db
//
// This does NOT replace testing against a real Supabase project. auth.users,
// auth.uid() and the client roles are stubbed below, and pgcrypto is stripped
// (gen_random_uuid() is core Postgres 13+; Supabase ships pgcrypto regardless).

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const MIG = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const db = await PGlite.create({ extensions: { citext, pg_trgm } });

await db.exec(`
  create schema if not exists auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text, phone text,
    created_at timestamptz not null default now()
  );
  create or replace function auth.uid() returns uuid
    language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create role anon; create role authenticated; create role service_role;
`);

for (const f of readdirSync(MIG).filter(f => f.endsWith('.sql')).sort()) {
  await db.exec(readFileSync(path.join(MIG, f), 'utf8')
    .replace(/create extension if not exists pgcrypto;/gi, ''));
}

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  ok    ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
}
const eq = (a, b, m) => { if (String(a) !== String(b)) throw new Error(`${m ?? ''} expected ${b}, got ${a}`); };
async function throws(sql, params, want) {
  try { await db.query(sql, params); throw new Error(`expected rejection (${want}) but it succeeded`); }
  catch (e) { if (!e.message.includes(want)) throw new Error(`wrong error: ${e.message}`); }
}
const one = async (sql, p = []) => (await db.query(sql, p)).rows[0];

// seed
const { rows: [college] } = await db.query(
  `insert into colleges (name, city, state) values ('IIT Bombay','Mumbai','Maharashtra') returning id`);
await db.query(`insert into college_domains (college_id, domain) values ($1,'iitb.ac.in'),($1,'student.iitb.ac.in')`, [college.id]);
const { rows: [u1] } = await db.query(`insert into auth.users (email) values ('a@gmail.com') returning id`);
const { rows: [u2] } = await db.query(`insert into auth.users (email) values ('b@iitb.ac.in') returning id`);

console.log('\nDomain lookup (fast path to Tier 2)');
await check('college email resolves to college', async () =>
  eq((await one(`select college_for_email('rahul@iitb.ac.in') c`)).c, college.id));
await check('subdomain listed separately also resolves', async () =>
  eq((await one(`select college_for_email('x@student.iitb.ac.in') c`)).c, college.id));
await check('gmail resolves to null (allowed, but no fast path)', async () =>
  eq((await one(`select college_for_email('x@gmail.com') c`)).c ?? 'null', 'null'));
await check('unlisted .ac.in resolves to null', async () =>
  eq((await one(`select college_for_email('x@randomcollege.ac.in') c`)).c ?? 'null', 'null'));
await check('case + whitespace tolerant', async () =>
  eq((await one(`select college_for_email('  Rahul@IITB.AC.IN ') c`)).c, college.id));
await check('wildcard domain rejected by shape check', () =>
  throws(`insert into college_domains (college_id, domain) values ($1,'*.iitb.ac.in')`, [college.id], 'college_domains_shape'));

console.log('\nProfile auto-creation and tiers');
await check('profile auto-created on signup', async () =>
  eq((await one(`select count(*) c from profiles where id=$1`, [u1.id])).c, 1));
await check('new user starts at Tier 0', async () =>
  eq((await one(`select trust_tier t from profiles where id=$1`, [u1.id])).t, 0));

console.log('\nUsername rules');
await check('valid username accepted', async () =>
  db.query(`update profiles set username='rahul_k' where id=$1`, [u1.id]));
await check('reserved username rejected', () =>
  throws(`update profiles set username='admin' where id=$1`, [u2.id], 'username_reserved'));
await check('reserved check is case-insensitive', () =>
  throws(`update profiles set username='LOOTY' where id=$1`, [u2.id], 'username_reserved'));
await check('too-short username rejected', () =>
  throws(`update profiles set username='ab' where id=$1`, [u2.id], 'profiles_username_shape'));
await check('duplicate username rejected', () =>
  throws(`update profiles set username='rahul_k' where id=$1`, [u2.id], 'profiles_username_key'));
await check('second change within 14 days rejected', () =>
  throws(`update profiles set username='rahul2' where id=$1`, [u1.id], 'username_change_too_soon'));
await check('change allowed once 14 days have passed', async () => {
  await db.query(`update profiles set username_changed_at = now() - interval '15 days' where id=$1`, [u1.id]);
  await db.query(`update profiles set username='rahul2' where id=$1`, [u1.id]);
});

console.log('\nVerification promotes tier (service-role path only)');
await check('flagged verification grants nothing', async () => {
  const { rows: [v] } = await db.query(
    `insert into verifications (user_id, method, status, claimed_college_id, face_match_score)
     values ($1,'id_card','flagged',$2,0.41) returning id`, [u1.id, college.id]);
  await db.query(`select apply_verification($1)`, [v.id]);
  eq((await one(`select trust_tier t from profiles where id=$1`, [u1.id])).t, 0);
});
await check('passed id_card → Tier 1 + college + name from OCR', async () => {
  const { rows: [v] } = await db.query(
    `insert into verifications (user_id, method, status, claimed_college_id, ocr_name, face_match_score)
     values ($1,'id_card','passed',$2,'Rahul Kumar',0.94) returning id`, [u1.id, college.id]);
  await db.query(`select apply_verification($1)`, [v.id]);
  const p = await one(`select trust_tier t, college_id c, full_name n from profiles where id=$1`, [u1.id]);
  eq(p.t, 1); eq(p.c, college.id); eq(p.n, 'Rahul Kumar');
});
await check('passed college_email → Tier 2', async () => {
  const { rows: [v] } = await db.query(
    `insert into verifications (user_id, method, status, claimed_college_id)
     values ($1,'college_email','passed',$2) returning id`, [u2.id, college.id]);
  await db.query(`select apply_verification($1)`, [v.id]);
  eq((await one(`select trust_tier t from profiles where id=$1`, [u2.id])).t, 2);
});
await check('tier never decreases (greatest)', async () => {
  const { rows: [v] } = await db.query(
    `insert into verifications (user_id, method, status) values ($1,'id_card','passed') returning id`, [u2.id]);
  await db.query(`select apply_verification($1)`, [v.id]);
  eq((await one(`select trust_tier t from profiles where id=$1`, [u2.id])).t, 2);
});

console.log('\nBans collapse the access gate');
await check('unbanned user is not banned', async () =>
  eq((await one(`select is_banned($1) b`, [u1.id])).b, false));
await check('temporary ban registers', async () => {
  await db.query(`insert into bans (user_id,type,ends_at) values ($1,'temporary',now()+interval '5 days')`, [u1.id]);
  eq((await one(`select is_banned($1) b`, [u1.id])).b, true);
});
await check('expired ban does not register', async () => {
  await db.query(`delete from bans where user_id=$1`, [u1.id]);
  await db.query(`insert into bans (user_id,type,ends_at) values ($1,'temporary',now()-interval '1 day')`, [u1.id]);
  eq((await one(`select is_banned($1) b`, [u1.id])).b, false);
});
await check('permanent ban must have null ends_at', () =>
  throws(`insert into bans (user_id,type,ends_at) values ($1,'permanent',now())`, [u1.id], 'bans_duration'));
await check('current_tier collapses to 0 while banned', async () => {
  await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [u2.id]);
  eq((await one(`select current_tier() t`)).t, 2);
  await db.query(`insert into bans (user_id,type,ends_at) values ($1,'temporary',now()+interval '5 days')`, [u2.id]);
  eq((await one(`select current_tier() t`)).t, 0, 'banned Tier 2 user');
  await db.query(`delete from bans where user_id=$1`, [u2.id]);
});
await check('anonymous caller is Tier 0', async () => {
  await db.query(`select set_config('request.jwt.claim.sub','',false)`);
  eq((await one(`select current_tier() t`)).t, 0);
});

console.log('\nColumn grants block privilege escalation');
await check('authenticated has no UPDATE grant on trust_tier', async () => {
  const r = await one(`select count(*) c from information_schema.column_privileges
    where table_name='profiles' and column_name='trust_tier'
      and grantee='authenticated' and privilege_type='UPDATE'`);
  eq(r.c, 0, 'trust_tier UPDATE grants');
});
await check('authenticated cannot read full_name', async () => {
  const r = await one(`select count(*) c from information_schema.column_privileges
    where table_name='profiles' and column_name='full_name' and grantee='authenticated'`);
  eq(r.c, 0, 'full_name grants');
});
await check('authenticated cannot read phone_hash', async () => {
  const r = await one(`select count(*) c from information_schema.column_privileges
    where table_name='profiles' and column_name='phone_hash' and grantee='authenticated'`);
  eq(r.c, 0, 'phone_hash grants');
});
await check('onboarding fields readable but not writable', async () => {
  for (const col of ['phone_verified_at', 'onboarding_complete']) {
    const r = await one(`select
        count(*) filter (where privilege_type='SELECT') sel,
        count(*) filter (where privilege_type in ('UPDATE','INSERT')) wr
      from information_schema.column_privileges
      where table_name='profiles' and column_name=$1 and grantee='authenticated'`, [col]);
    eq(r.sel, 1, `${col} SELECT grant`);
    eq(r.wr, 0, `${col} write grants`);
  }
});
await check('banned_phone_hashes has no client grants at all', async () => {
  const r = await one(`select count(*) c from information_schema.table_privileges
    where table_name='banned_phone_hashes' and grantee in ('anon','authenticated')`);
  eq(r.c, 0);
});
await check('apply_verification not executable by clients', async () => {
  const r = await one(`select has_function_privilege('authenticated','apply_verification(uuid)','execute') x`);
  eq(r.x, false);
});
await check('RLS enabled on every public table', async () => {
  const r = await one(`select count(*) c from pg_class
    where relnamespace='public'::regnamespace and relkind='r' and not relrowsecurity`);
  eq(r.c, 0, 'tables without RLS');
});

console.log('\nAlumni badge');
await check('current student is not alumni', async () =>
  eq((await one(`select is_alumni((extract(year from now())+2)::smallint) a`)).a, false));
await check('past end year is alumni', async () =>
  eq((await one(`select is_alumni((extract(year from now())-1)::smallint) a`)).a, true));
await check('null end year is not alumni', async () =>
  eq((await one(`select coalesce(is_alumni(null),false) a`)).a, false));

// ---------------------------------------------------------------------------
// Phase 2 — exercised as a real `authenticated` user so RLS actually applies.
// Everything above this line runs as superuser and therefore bypasses RLS; these
// tests are the ones that prove the security boundary rather than its metadata.
// ---------------------------------------------------------------------------

await db.exec(`grant usage on schema public to authenticated`);

async function asUser(uid, fn) {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
  await db.exec(`set role authenticated`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role`);
  }
}
/**
 * RLS refuses in two different ways, and conflating them hides real bugs:
 *
 *   INSERT  violating a WITH CHECK raises an error        → use denied()
 *   UPDATE / DELETE / SELECT  a USING clause that does not match simply makes the
 *           row invisible, so the statement succeeds against ZERO rows → noEffect()
 *
 * A test that only looks for a thrown error will pass an UPDATE that was actually
 * refused, and would equally pass one that wasn't. Hence two helpers.
 */
async function denied(uid, sql, params = []) {
  return asUser(uid, async () => {
    try {
      await db.query(sql, params);
      throw new Error('expected the database to refuse this, but it succeeded');
    } catch (e) {
      if (e.message.startsWith('expected the database')) throw e;
    }
  });
}
async function noEffect(uid, sql, params = []) {
  return asUser(uid, async () => {
    const r = await db.query(sql, params);
    const n = r.affectedRows ?? 0;
    if (n > 0) throw new Error(`expected RLS to match no rows, but ${n} were changed`);
  });
}

// Fresh cast: three verified students, all old enough to report.
const users = {};
for (const name of ['ana', 'bo', 'cy']) {
  const { rows: [u] } = await db.query(
    `insert into auth.users (email) values ($1) returning id`, [`${name}@iitb.ac.in`]);
  users[name] = u.id;
  // Usernames must be 3–20 chars, so the short fixture keys get a suffix.
  await db.query(
    `update profiles set username=$2, trust_tier=1, college_id=$3,
       created_at = now() - interval '30 days' where id=$1`,
    [u.id, `${name}_looty`, college.id]);
}
const { ana, bo, cy } = users;

console.log('\nFriendships');
await check('Tier 1 user can send a request', () =>
  asUser(ana, () => db.query(
    `insert into friendships (requester_id, addressee_id) values ($1,$2)`, [ana, bo])));
await check('reverse duplicate request is refused', () =>
  denied(bo, `insert into friendships (requester_id, addressee_id) values ($1,$2)`, [bo, ana]));
await check('requester cannot accept their own request', async () => {
  await noEffect(ana, `update friendships set status='accepted' where requester_id=$1`, [ana]);
  eq((await one(`select status from friendships where requester_id=$1`, [ana])).status, 'pending');
});
await check('addressee can accept', () =>
  asUser(bo, () => db.query(`update friendships set status='accepted' where addressee_id=$1`, [bo])));
await check('Tier 0 user cannot send a request', async () => {
  await db.query(`update profiles set trust_tier=0 where id=$1`, [cy]);
  await denied(cy, `insert into friendships (requester_id, addressee_id) values ($1,$2)`, [cy, ana]);
  await db.query(`update profiles set trust_tier=1 where id=$1`, [cy]);
});
await check('cannot forge a request from someone else', () =>
  denied(cy, `insert into friendships (requester_id, addressee_id) values ($1,$2)`, [ana, cy]));

console.log('\nDM threads');
await check('open_dm_thread works between friends', () =>
  asUser(ana, async () => {
    const r = await db.query(`select open_dm_thread($1) id`, [bo]);
    if (!r.rows[0].id) throw new Error('no thread returned');
  }));
await check('opening twice returns the same thread', () =>
  asUser(bo, async () => {
    const a = (await db.query(`select open_dm_thread($1) id`, [ana])).rows[0].id;
    const n = (await db.query(`select count(*) c from threads where type='dm'`)).rows[0].c;
    eq(n, 1, 'thread count'); if (!a) throw new Error('no id');
  }));
await check('cannot open a thread with a non-friend', () =>
  denied(ana, `select open_dm_thread($1)`, [cy]));

console.log('\nMessages');
const threadId = (await db.query(`select id from threads limit 1`)).rows[0].id;
await check('participant can send', () =>
  asUser(ana, () => db.query(
    `insert into messages (thread_id, sender_id, body) values ($1,$2,'hey')`, [threadId, ana])));
await check('non-participant cannot send', () =>
  denied(cy, `insert into messages (thread_id, sender_id, body) values ($1,$2,'intruding')`, [threadId, cy]));
await check('non-participant cannot read', () =>
  asUser(cy, async () => {
    const r = await db.query(`select count(*) c from messages where thread_id=$1`, [threadId]);
    eq(r.rows[0].c, 0, 'messages visible to outsider');
  }));
await check('cannot send as another user', () =>
  denied(bo, `insert into messages (thread_id, sender_id, body) values ($1,$2,'forged')`, [threadId, ana]));
await check('empty message refused', () =>
  denied(ana, `insert into messages (thread_id, sender_id, body) values ($1,$2,'   ')`, [threadId, ana]));
await check('image-only message allowed', () =>
  asUser(ana, () => db.query(
    `insert into messages (thread_id, sender_id, image_url) values ($1,$2,'s3://x.jpg')`, [threadId, ana])));
await check('messages are not editable by anyone', async () => {
  const r = await one(`select count(*) c from information_schema.column_privileges
    where table_name='messages' and grantee='authenticated' and privilege_type='UPDATE'`);
  eq(r.c, 0);
});
await check('cannot delete the other side’s message', async () => {
  const before = (await one(`select count(*) c from messages where sender_id=$1`, [ana])).c;
  await noEffect(bo, `delete from messages where sender_id=$1`, [ana]);
  eq((await one(`select count(*) c from messages where sender_id=$1`, [ana])).c, before, 'ana messages');
});

console.log('\nBlocking');
await check('blocking is symmetric in effect', async () => {
  await asUser(cy, () => db.query(`insert into blocks (blocker_id, blocked_id) values ($1,$2)`, [cy, ana]));
  eq((await one(`select is_blocked_pair($1,$2) b`, [ana, cy])).b, true, 'ana→cy');
  eq((await one(`select is_blocked_pair($1,$2) b`, [cy, ana])).b, true, 'cy→ana');
});
await check('blocked party cannot discover the block', () =>
  asUser(ana, async () => {
    const r = await db.query(`select count(*) c from blocks`);
    eq(r.rows[0].c, 0, 'blocks visible to blocked user');
  }));
await check('blocked users disappear from profile reads', () =>
  asUser(ana, async () => {
    const r = await db.query(`select count(*) c from profiles where id=$1`, [cy]);
    eq(r.rows[0].c, 0, 'blocker still visible');
  }));
await check('self-block refused', () =>
  denied(ana, `insert into blocks (blocker_id, blocked_id) values ($1,$1)`, [ana]));
await check('blocking tears down the friendship', async () => {
  await asUser(ana, () => db.query(`insert into blocks (blocker_id, blocked_id) values ($1,$2)`, [ana, bo]));
  eq((await one(`select count(*) c from friendships`)).c, 0, 'friendship survived a block');
});
await check('blocked pair cannot post to their old thread', () =>
  denied(ana, `insert into messages (thread_id, sender_id, body) values ($1,$2,'still here')`, [threadId, ana]));

console.log('\nReports');
await check('eligible user can report', () =>
  asUser(ana, () => db.query(
    `insert into reports (reporter_id, target_id, context, reason) values ($1,$2,'profile','harassment')`,
    [ana, cy])));
await check('same reporter cannot report the same target twice', () =>
  denied(ana, `insert into reports (reporter_id, target_id, context, reason)
               values ($1,$2,'dm','spam')`, [ana, cy]));
await check('blocking does NOT prevent reporting', () =>
  asUser(cy, () => db.query(
    `insert into reports (reporter_id, target_id, context, reason) values ($1,$2,'profile','harassment')`,
    [cy, ana])));
await check('self-report refused', () =>
  denied(ana, `insert into reports (reporter_id, target_id, context, reason)
               values ($1,$1,'profile','spam')`, [ana]));
await check('account younger than 7 days cannot report', async () => {
  const { rows: [u] } = await db.query(`insert into auth.users (email) values ('new@iitb.ac.in') returning id`);
  await db.query(`update profiles set trust_tier=1, created_at=now() - interval '2 days' where id=$1`, [u.id]);
  await denied(u.id, `insert into reports (reporter_id, target_id, context, reason)
                      values ($1,$2,'profile','spam')`, [u.id, bo]);
});
await check('Tier 0 user cannot report', async () => {
  await db.query(`update profiles set trust_tier=0 where id=$1`, [cy]);
  await denied(cy, `insert into reports (reporter_id, target_id, context, reason)
                    values ($1,$2,'profile','spam')`, [cy, bo]);
  await db.query(`update profiles set trust_tier=1 where id=$1`, [cy]);
});
await check('banned user cannot report', async () => {
  await db.query(`insert into bans (user_id,type,ends_at) values ($1,'temporary',now()+interval '5 days')`, [bo]);
  await denied(bo, `insert into reports (reporter_id, target_id, context, reason)
                    values ($1,$2,'profile','spam')`, [bo, cy]);
  await db.query(`delete from bans where user_id=$1`, [bo]);
});
await check('reports cannot be read back by anyone', async () => {
  const r = await one(`select count(*) c from information_schema.table_privileges
    where table_name='reports' and grantee='authenticated' and privilege_type='SELECT'`);
  eq(r.c, 0, 'SELECT grants on reports');
});

console.log(`\n${pass} passed, ${fail} failed`);
await db.close();
process.exit(fail ? 1 : 0);
