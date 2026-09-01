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

  -- Supabase's storage schema, stubbed just enough for the avatars migration to
  -- run. Enough to catch SQL and policy-shape errors; not a real storage test.
  create schema if not exists storage;
  create table storage.buckets (
    id text primary key, name text, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[]
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text, name text, owner uuid
  );
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(p_name text) returns text[]
    language sql immutable as $$ select string_to_array(p_name, '/') $$;

  -- Supabase ships this publication; pglite does not. Created empty so the
  -- realtime migration runs as written.
  create publication supabase_realtime;
`);

// pglite attaches the whole bundled module to thrown errors, so an unhandled one
// buries the actual message under megabytes of minified JS. Report and stop.
for (const f of readdirSync(MIG).filter(f => f.endsWith('.sql')).sort()) {
  try {
    await db.exec(readFileSync(path.join(MIG, f), 'utf8')
      .replace(/create extension if not exists pgcrypto;/gi, ''));
  } catch (e) {
    console.error(`\nMIGRATION FAILED  ${f}`);
    console.error(`  ${e.message}`);
    for (const k of ['detail', 'hint', 'constraint', 'column', 'routine']) {
      if (e[k]) console.error(`  ${k}: ${e[k]}`);
    }
    process.exit(1);
  }
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

console.log('\nUsername rules as a client');
await check('authenticated user can pick a username', async () => {
  // The reserved-list trigger used to run as the caller, so this exact statement
  // returned 42501 on live while every superuser username test stayed green.
  const { rows: [u] } = await db.query(
    `insert into auth.users (email) values ('namepick@gmail.com') returning id`);
  await asUser(u.id, () =>
    db.query(`update profiles set username='namepick' where id=$1`, [u.id]));
  eq((await one(`select username from profiles where id=$1`, [u.id])).username, 'namepick');
});
await check('authenticated user is still refused a reserved username', async () => {
  const { rows: [u] } = await db.query(
    `insert into auth.users (email) values ('resname@gmail.com') returning id`);
  await denied(u.id, `update profiles set username='admin' where id=$1`, [u.id]);
});

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
    `insert into messages (thread_id, sender_id, image_url)
     values ($1,$2,$3)`, [threadId, ana, `${ana}/${threadId}/probe.jpg`])));
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

// ---------------------------------------------------------------------------
// College email verification — the ONLY route to full access now that the ID
// card path is dormant. If these break, nobody can reach Tier 2.
// ---------------------------------------------------------------------------

async function issueCode(uid, code, { email = 'someone@iitb.ac.in', minutes = 10, collegeId = college.id } = {}) {
  await db.query(`update email_verifications set consumed_at = now() where user_id = $1 and consumed_at is null`, [uid]);
  const salt = 'salt_' + Math.random().toString(36).slice(2);
  await db.query(
    `insert into email_verifications (user_id, email, college_id, code_salt, code_hash, expires_at)
     values ($1,$2,$3,$4, hash_email_code($5,$4), now() + ($6 || ' minutes')::interval)`,
    [uid, email, collegeId, salt, code, String(minutes)]);
}

const { rows: [ed] } = await db.query(`insert into auth.users (email) values ('ed@gmail.com') returning id`);
const edId = ed.id;
await db.query(`update profiles set username='ed_looty', created_at=now()-interval '30 days' where id=$1`, [edId]);

// confirm_college_email returns a status rather than raising — see the migration
// for why. So these assert on the returned value, not on a thrown error.
const confirm = (uid, code) =>
  asUser(uid, async () =>
    (await db.query(`select confirm_college_email($1) s`, [code])).rows[0].s);

console.log('\nCollege email verification');
await check('new Google signup starts at Tier 0', async () =>
  eq((await one(`select trust_tier t from profiles where id=$1`, [edId])).t, 0));
await check('wrong code is refused and the attempt actually persists', async () => {
  await issueCode(edId, '123456');
  eq(await confirm(edId, '999999'), 'invalid_code');
  // The counter must survive the call. If this reads 0, the lockout below is dead.
  eq((await one(`select attempts a from email_verifications where user_id=$1 order by created_at desc limit 1`, [edId])).a, 1);
});
await check('correct code promotes straight to Tier 2', async () => {
  eq(await confirm(edId, '123456'), 'ok');
  const p = await one(`select trust_tier t, college_id c from profiles where id=$1`, [edId]);
  eq(p.t, 2, 'tier'); eq(p.c, college.id, 'college');
});
await check('college_email is recorded but never client-readable', async () => {
  eq((await one(`select college_email e from profiles where id=$1`, [edId])).e, 'someone@iitb.ac.in');
  const g = await one(`select count(*) c from information_schema.column_privileges
    where table_name='profiles' and column_name='college_email' and grantee='authenticated'`);
  eq(g.c, 0, 'college_email grants');
});
await check('a consumed code cannot be reused', async () =>
  eq(await confirm(edId, '123456'), 'no_pending'));
await check('expired code is refused', async () => {
  await issueCode(edId, '222222', { minutes: -1 });
  eq(await confirm(edId, '222222'), 'expired');
});
await check('locked out after 5 wrong attempts, even with the right code', async () => {
  await issueCode(edId, '333333');
  for (let i = 0; i < 5; i++) eq(await confirm(edId, '000000'), 'invalid_code');
  eq(await confirm(edId, '333333'), 'too_many_attempts', 'right code after lockout');
});
await check('an address already claimed by someone else is refused', async () => {
  const { rows: [f] } = await db.query(`insert into auth.users (email) values ('fi@gmail.com') returning id`);
  await issueCode(f.id, '444444', { email: 'someone@iitb.ac.in' });
  eq(await confirm(f.id, '444444'), 'email_already_claimed');
});
await check('a banned address cannot be reused on a new account', async () => {
  const { rows: [g] } = await db.query(`insert into auth.users (email) values ('gu@gmail.com') returning id`);
  await db.query(
    `insert into banned_identities (hash, kind)
     values (encode(sha256(convert_to(lower('banned@iitb.ac.in'),'UTF8')),'hex'),'college_email')`);
  await issueCode(g.id, '555555', { email: 'banned@iitb.ac.in' });
  eq(await confirm(g.id, '555555'), 'identity_banned');
});
await check('code hash and salt are never readable by the client', async () => {
  for (const col of ['code_hash', 'code_salt']) {
    const r = await one(`select count(*) c from information_schema.column_privileges
      where table_name='email_verifications' and column_name=$1 and grantee='authenticated'`, [col]);
    eq(r.c, 0, `${col} grants`);
  }
});
await check('clients cannot issue codes to themselves', async () => {
  const r = await one(`select count(*) c from information_schema.table_privileges
    where table_name='email_verifications' and grantee='authenticated'
      and privilege_type in ('INSERT','UPDATE')`);
  eq(r.c, 0);
});
await check('banned_identities has no client grants', async () => {
  const r = await one(`select count(*) c from information_schema.table_privileges
    where table_name='banned_identities' and grantee in ('anon','authenticated')`);
  eq(r.c, 0);
});
await check('Tier 2 user can do everything Tier 1 could', async () => {
  await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [edId]);
  eq((await one(`select current_tier() t`)).t, 2);
  eq((await one(`select can_report() r`)).r, true);
});

// ---------------------------------------------------------------------------
// Phase 3 — groups
// ---------------------------------------------------------------------------

const g = {};
for (const name of ['gina', 'greg', 'gus']) {
  const { rows: [u] } = await db.query(`insert into auth.users (email) values ($1) returning id`, [`${name}@iitb.ac.in`]);
  g[name] = u.id;
  await db.query(
    `update profiles set username=$2, trust_tier=2, college_id=$3, created_at=now()-interval '30 days' where id=$1`,
    [u.id, name, college.id]);
}
const joinAs = (uid, cat = 'study') =>
  asUser(uid, async () => (await db.query(`select join_group($1) id`, [cat])).rows[0].id);

console.log('\nGroups — joining and capacity');
await check('first joiner creates Study 1', async () => {
  const id = await joinAs(g.gina);
  const r = await one(`select name, room_number rn, member_count mc from groups where id=$1`, [id]);
  eq(r.name, 'Study 1'); eq(r.rn, 1); eq(r.mc, 1, 'member_count');
});
await check('joining again returns the same room', async () => {
  const a = await joinAs(g.gina);
  const b = await joinAs(g.gina);
  eq(a, b);
  eq((await one(`select count(*) c from group_members where user_id=$1 and category='study'`, [g.gina])).c, 1);
});
await check('room at capacity spills into Study 2', async () => {
  await db.query(`update groups set capacity=1 where name='Study 1'`);
  const id = await joinAs(g.greg);
  eq((await one(`select name from groups where id=$1`, [id])).name, 'Study 2');
});
await check('member_count tracks joins and leaves', async () => {
  const before = (await one(`select member_count mc from groups where name='Study 2'`)).mc;
  await asUser(g.greg, () => db.query(`select leave_group('study')`));
  eq((await one(`select member_count mc from groups where name='Study 2'`)).mc, before - 1);
});
await check('a user cannot be in two rooms of one category', async () => {
  const id2 = (await one(`select id from groups where name='Study 2'`)).id;
  await denied(g.gina, `insert into group_members (group_id, user_id, category) values ($1,$2,'study')`, [id2, g.gina]);
});
await check('categories are independent', async () => {
  const s = await joinAs(g.gina, 'sports');
  eq((await one(`select name from groups where id=$1`, [s])).name, 'Sports 1');
});
await check('Tier 0 cannot join', async () => {
  await db.query(`update profiles set trust_tier=0 where id=$1`, [g.gus]);
  await denied(g.gus, `select join_group('friends')`);
});
await check('banned user cannot join', async () => {
  await db.query(`update profiles set trust_tier=2 where id=$1`, [g.gus]);
  await db.query(`insert into bans (user_id,type,ends_at) values ($1,'temporary',now()+interval '5 days')`, [g.gus]);
  await denied(g.gus, `select join_group('friends')`);
  await db.query(`delete from bans where user_id=$1`, [g.gus]);
});
await check('membership cannot be forged directly', async () => {
  const id = (await one(`select id from groups where name='Study 2'`)).id;
  await denied(g.gus, `insert into group_members (group_id, user_id, category) values ($1,$2,'study')`, [id, g.gus]);
});

console.log('\nGroups — posting');
const studyRoom = await joinAs(g.gus);
await check('member can post', () =>
  asUser(g.gus, () => db.query(
    `insert into group_messages (group_id, sender_id, body) values ($1,$2,'hello room')`, [studyRoom, g.gus])));
await check('non-member cannot post', async () => {
  const other = (await one(`select id from groups where name='Study 1'`)).id;
  await denied(g.gus, `insert into group_messages (group_id, sender_id, body) values ($1,$2,'wrong room')`, [other, g.gus]);
});
await check('Tier 0 can READ group messages', async () => {
  await db.query(`update profiles set trust_tier=0 where id=$1`, [g.gus]);
  await asUser(g.gus, async () => {
    const r = await db.query(`select count(*) c from group_messages`);
    if (Number(r.rows[0].c) < 1) throw new Error('Tier 0 saw no messages');
  });
  await db.query(`update profiles set trust_tier=2 where id=$1`, [g.gus]);
});
await check('Tier 0 cannot POST', async () => {
  await db.query(`update profiles set trust_tier=0 where id=$1`, [g.gus]);
  await denied(g.gus, `insert into group_messages (group_id, sender_id, body) values ($1,$2,'sneaking in')`, [studyRoom, g.gus]);
  await db.query(`update profiles set trust_tier=2 where id=$1`, [g.gus]);
});
await check('empty message refused', () =>
  denied(g.gus, `insert into group_messages (group_id, sender_id, body) values ($1,$2,'   ')`, [studyRoom, g.gus]));
await check('group messages are text only — no image column exists', async () => {
  const r = await one(`select count(*) c from information_schema.columns
    where table_name='group_messages' and column_name in ('image_url','video_url','media_url')`);
  eq(r.c, 0, 'media columns');
});
await check('group messages are not editable by anyone', async () => {
  const r = await one(`select count(*) c from information_schema.column_privileges
    where table_name='group_messages' and grantee='authenticated' and privilege_type='UPDATE'`);
  eq(r.c, 0);
});
await check('rate limit stops a flood at 10/minute', async () => {
  await db.query(`delete from group_messages where sender_id=$1`, [g.gus]);
  for (let i = 0; i < 10; i++) {
    await asUser(g.gus, () => db.query(
      `insert into group_messages (group_id, sender_id, body) values ($1,$2,$3)`, [studyRoom, g.gus, 'msg ' + i]));
  }
  await denied(g.gus, `insert into group_messages (group_id, sender_id, body) values ($1,$2,'eleventh')`, [studyRoom, g.gus]);
});
await check('rate limit spans rooms, not just one', async () => {
  const sports = await joinAs(g.gus, 'sports');
  await denied(g.gus, `insert into group_messages (group_id, sender_id, body) values ($1,$2,'spillover')`, [sports, g.gus]);
  await db.query(`delete from group_messages where sender_id=$1`, [g.gus]);
});

console.log('\nGroups — word filter');
await check('blocked term is rejected', async () => {
  await db.query(`insert into blocked_terms (term) values ('cat')`);
  await denied(g.gus, `insert into group_messages (group_id, sender_id, body) values ($1,$2,'look at that cat')`, [studyRoom, g.gus]);
});
await check('matching is on word boundaries, not substrings', () =>
  // "concatenate" contains "cat". A LIKE '%cat%' filter would wrongly reject this
  // — the Scunthorpe problem. Word boundaries must let it through.
  asUser(g.gus, () => db.query(
    `insert into group_messages (group_id, sender_id, body) values ($1,$2,'concatenate the strings')`, [studyRoom, g.gus])));
await check('filter is case-insensitive', () =>
  denied(g.gus, `insert into group_messages (group_id, sender_id, body) values ($1,$2,'CAT!')`, [studyRoom, g.gus]));
await check('word list is never readable by clients', async () => {
  const r = await one(`select count(*) c from information_schema.table_privileges
    where table_name='blocked_terms' and grantee in ('anon','authenticated')`);
  eq(r.c, 0);
});

// ---------------------------------------------------------------------------
// Phase 4 — Looty Match
// ---------------------------------------------------------------------------

const otherCollege = (await db.query(
  `insert into colleges (name, city, state) values ('NIT Trichy','Tiruchirappalli','Tamil Nadu') returning id`)).rows[0].id;

async function mkUser(name, { tier = 2, collegeId = college.id, gender = 'woman' } = {}) {
  const { rows: [u] } = await db.query(`insert into auth.users (email) values ($1) returning id`, [`${name}@iitb.ac.in`]);
  // onboarding_complete is derived by trigger, so the fixture has to supply every
  // field a real profile would have rather than just asserting the flag.
  await db.query(
    `update profiles set username=$2, trust_tier=$3, college_id=$4, gender=$5,
       dp_url='https://example.test/dp.jpg', display_name=$6,
       course_years=4, start_year=extract(year from now())::smallint,
       created_at=now()-interval '30 days' where id=$1`,
    [u.id, name + '_m', tier, collegeId, gender, name]);
  return u.id;
}
const mia = await mkUser('mia');
const noor = await mkUser('noor');
const raj = await mkUser('raj', { gender: 'man' });
const far = await mkUser('far', { collegeId: otherCollege });

const loot = (actor, target, action = 'loot') =>
  asUser(actor, () => db.query(
    `insert into loots (actor_id, target_id, action) values ($1,$2,$3)`, [actor, target, action]));
const feedFor = (uid) =>
  asUser(uid, async () => (await db.query(`select id from match_feed(50)`)).rows.map(r => r.id));

console.log('\nLooty Match — looting');
await check('a loot is recorded', () => loot(mia, noor));
await check('deciding twice on the same person is refused', () =>
  denied(mia, `insert into loots (actor_id, target_id, action) values ($1,$2,'pass')`, [mia, noor]));
await check('self-loot refused', () =>
  denied(mia, `insert into loots (actor_id, target_id, action) values ($1,$1,'loot')`, [mia]));
await check('cannot loot on someone else’s behalf', () =>
  denied(raj, `insert into loots (actor_id, target_id, action) values ($1,$2,'loot')`, [mia, raj]));
await check('Tier 0 cannot loot', async () => {
  await db.query(`update profiles set trust_tier=0 where id=$1`, [raj]);
  await denied(raj, `insert into loots (actor_id, target_id, action) values ($1,$2,'loot')`, [raj, mia]);
  await db.query(`update profiles set trust_tier=2 where id=$1`, [raj]);
});

console.log('\nLooty Match — connections');
await check('mutual loot creates a Connection and its chat', async () => {
  await loot(noor, mia);
  eq((await one(`select count(*) c from connections where user_a=least($1::uuid,$2::uuid) and user_b=greatest($1::uuid,$2::uuid)`, [mia, noor])).c, 1, 'connection');
  eq((await one(`select count(*) c from threads where type='connection' and user_a=least($1::uuid,$2::uuid) and user_b=greatest($1::uuid,$2::uuid)`, [mia, noor])).c, 1, 'thread');
});
await check('a pass is final — the other person looting does not connect', async () => {
  await loot(mia, raj, 'pass');
  await loot(raj, mia);
  eq((await one(`select count(*) c from connections where user_a=least($1::uuid,$2::uuid) and user_b=greatest($1::uuid,$2::uuid)`, [mia, raj])).c, 0);
});
await check('connections cannot be created directly', () =>
  denied(mia, `insert into connections (user_a, user_b) values (least($1::uuid,$2::uuid), greatest($1::uuid,$2::uuid))`, [mia, far]));
await check('either side can end a Connection', async () => {
  await asUser(noor, () => db.query(
    `update connections set status='ended', ended_at=now() where user_a=least($1::uuid,$2::uuid) and user_b=greatest($1::uuid,$2::uuid)`, [mia, noor]));
  eq((await one(`select status from connections where user_a=least($1::uuid,$2::uuid) and user_b=greatest($1::uuid,$2::uuid)`, [mia, noor])).status, 'ended');
});

console.log('\nLooty Match — daily quota (IST)');
const quotaUser = await mkUser('quo');
await check('free tier stops at 10 loots a day', async () => {
  for (let i = 0; i < 10; i++) {
    const t = await mkUser('t' + i);
    await loot(quotaUser, t);
  }
  eq((await one(`select loots_used_today($1) n`, [quotaUser])).n, 10);
  const extra = await mkUser('extra');
  await denied(quotaUser, `insert into loots (actor_id, target_id, action) values ($1,$2,'loot')`, [quotaUser, extra]);
});
await check('passes are free and uncapped', async () => {
  for (let i = 0; i < 5; i++) {
    const t = await mkUser('p' + i);
    await loot(quotaUser, t, 'pass');   // still at the loot cap, must succeed
  }
});
await check('quota counts on the IST day, not UTC', async () => {
  // A loot made "yesterday" in IST must not count today.
  await db.query(
    `update loots set created_at = now() - interval '2 days' where actor_id=$1`, [quotaUser]);
  eq((await one(`select loots_used_today($1) n`, [quotaUser])).n, 0);
});
await check('paid tier gets 50', async () => {
  eq((await one(`select daily_loot_limit($1) n`, [quotaUser])).n, 10);
  await db.query(`insert into subscriptions (user_id, status, current_period_end)
                  values ($1,'active', now()+interval '30 days')`, [quotaUser]);
  eq((await one(`select daily_loot_limit($1) n`, [quotaUser])).n, 50);
});
await check('expired subscription does not count as paid', async () => {
  await db.query(`update subscriptions set current_period_end = now()-interval '1 day' where user_id=$1`, [quotaUser]);
  eq((await one(`select is_paid($1) p`, [quotaUser])).p, false);
  await db.query(`delete from subscriptions where user_id=$1`, [quotaUser]);
});

console.log('\nLooty Match — "looted you" is paid, and enforced server-side');
const admirer = await mkUser('adm');
const admired = await mkUser('adr');
await check('free user gets a count but NO identities', async () => {
  await loot(admirer, admired);
  await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [admired]);
  eq((await one(`select looted_you_count() c`)).c, 1, 'count');
  eq((await db.query(`select * from looted_you()`)).rows.length, 0, 'rows leaked to free user');
});
await check('paid user gets the identities', async () => {
  await db.query(`insert into subscriptions (user_id, status, current_period_end)
                  values ($1,'active', now()+interval '30 days')`, [admired]);
  await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [admired]);
  const rows = (await db.query(`select * from looted_you()`)).rows;
  eq(rows.length, 1); eq(rows[0].id, admirer);
});
await check('the loots table cannot be read by target — that is the paid feature', async () => {
  const r = await one(`select count(*) c from pg_policies
    where tablename='loots' and cmd='SELECT' and qual like '%target_id%'`);
  eq(r.c, 0, 'policies exposing target_id');
});

console.log('\nLooty Match — feed filters');
await check('feed excludes self and anyone already decided on', async () => {
  const ids = await feedFor(mia);
  if (ids.includes(mia)) throw new Error('self in feed');
  if (ids.includes(noor)) throw new Error('already-looted user in feed');
  if (ids.includes(raj)) throw new Error('passed user in feed');
});
await check('default scope is same college only', async () => {
  const ids = await feedFor(mia);
  if (ids.includes(far)) throw new Error('other-college user in same_college feed');
});
await check('all_india scope widens the feed', async () => {
  await db.query(`update profiles set match_scope='all_india' where id=$1`, [mia]);
  const ids = await feedFor(mia);
  if (!ids.includes(far)) throw new Error('other-college user missing from all_india feed');
});
await check('same-gender safety toggle filters the feed', async () => {
  const man = await mkUser('man1', { gender: 'man' });
  await db.query(`update profiles set match_same_gender_only=true where id=$1`, [mia]);
  const ids = await feedFor(mia);
  if (ids.includes(man)) throw new Error('opposite gender present with safety toggle on');
  await db.query(`update profiles set match_same_gender_only=false where id=$1`, [mia]);
});
await check('blocked users never appear in the feed', async () => {
  const blocked = await mkUser('blk');
  await asUser(blocked, () => db.query(`insert into blocks (blocker_id, blocked_id) values ($1,$2)`, [blocked, mia]));
  const ids = await feedFor(mia);
  if (ids.includes(blocked)) throw new Error('blocker in feed');
});
await check('banned and unverified users are hidden from the feed', async () => {
  const banned = await mkUser('ban1');
  const tier0 = await mkUser('unverif', { tier: 0 });
  await db.query(`insert into bans (user_id,type,ends_at) values ($1,'temporary',now()+interval '5 days')`, [banned]);
  const ids = await feedFor(mia);
  if (ids.includes(banned)) throw new Error('banned user in feed');
  if (ids.includes(tier0)) throw new Error('unverified user in feed');
});

console.log('\nLooty Match — filter preferences');
await check('a user can change their own filters', () =>
  asUser(mia, () => db.query(
    `update profiles set match_scope='all_india', match_same_gender_only=true where id=$1`, [mia])));
await check('my_match_prefs returns the caller’s own settings', () =>
  asUser(mia, async () => {
    const r = (await db.query(`select * from my_match_prefs()`)).rows[0];
    eq(r.match_scope, 'all_india');
    eq(r.match_same_gender_only, true);
  }));
await check('filters are not readable about other users', async () => {
  for (const col of ['match_scope', 'match_same_gender_only']) {
    const r = await one(`select count(*) c from information_schema.column_privileges
      where table_name='profiles' and column_name=$1 and grantee='authenticated'
        and privilege_type='SELECT'`, [col]);
    eq(r.c, 0, `${col} should not be broadly readable`);
  }
  await db.query(`update profiles set match_scope='same_college', match_same_gender_only=false where id=$1`, [mia]);
});

console.log('\nLooty Match — blocking tears down a Connection');
await check('blocking ends the Connection and its chat', async () => {
  const x = await mkUser('conx'), y = await mkUser('cony');
  await loot(x, y); await loot(y, x);
  eq((await one(`select status from connections where user_a=least($1::uuid,$2::uuid) and user_b=greatest($1::uuid,$2::uuid)`, [x, y])).status, 'active');
  await asUser(x, () => db.query(`insert into blocks (blocker_id, blocked_id) values ($1,$2)`, [x, y]));
  eq((await one(`select status from connections where user_a=least($1::uuid,$2::uuid) and user_b=greatest($1::uuid,$2::uuid)`, [x, y])).status, 'ended');
  const t = await one(`select ended_at from threads where type='connection' and user_a=least($1::uuid,$2::uuid) and user_b=greatest($1::uuid,$2::uuid)`, [x, y]);
  if (!t.ended_at) throw new Error('thread not ended');
});

// ---------------------------------------------------------------------------
// Phase 5 — automatic moderation
// ---------------------------------------------------------------------------

let modSeq = 0;
async function fileReports(target, n) {
  const reporters = [];
  for (let i = 0; i < n; i++) {
    const r = await mkUser('rep' + (modSeq++));
    await db.query(`update profiles set college_email = $2 where id=$1`, [r, `rep${modSeq}@iitb.ac.in`]);
    await asUser(r, () => db.query(
      `insert into reports (reporter_id, target_id, context, reason)
       values ($1,$2,'profile','harassment')`, [r, target]));
    reporters.push(r);
  }
  return reporters;
}
const banState = (uid) => one(
  `select type, ends_at, lifted_at, lift_reason from bans
   where user_id=$1 order by created_at desc limit 1`, [uid]);

console.log('\nModeration — the ban threshold');
const victim1 = await mkUser('vic1');
await check('7 reports is not enough', async () => {
  await fileReports(victim1, 7);
  eq((await one(`select is_banned($1) b`, [victim1])).b, false);
});
await check('the 8th report triggers a 5-day ban', async () => {
  await fileReports(victim1, 1);
  const b = await banState(victim1);
  eq(b.type, 'temporary');
  eq((await one(`select is_banned($1) b`, [victim1])).b, true);
  const days = (await one(
    `select round(extract(epoch from (ends_at - starts_at))/86400) d from bans where user_id=$1`, [victim1])).d;
  eq(days, 5, 'ban length in days');
});
await check('the reports are spent, so the same incident cannot ban twice', async () => {
  eq((await one(`select count(*) c from reports where target_id=$1 and resolved_by_ban_id is null`, [victim1])).c, 0);
});
await check('a second ban needs 8 fresh reports', async () => {
  await db.query(`update bans set ends_at = now() - interval '1 day' where user_id=$1`, [victim1]);
  eq((await one(`select is_banned($1) b`, [victim1])).b, false);
  await fileReports(victim1, 7);
  eq((await one(`select is_banned($1) b`, [victim1])).b, false, 'banned on only 7 fresh reports');
  await fileReports(victim1, 1);
  eq((await one(`select is_banned($1) b`, [victim1])).b, true);
});
await check('the third ban is permanent and anchors the college address', async () => {
  await db.query(`update profiles set college_email='vic1@iitb.ac.in' where id=$1`, [victim1]);
  await db.query(`update bans set ends_at = now() - interval '1 day' where user_id=$1 and ends_at is not null`, [victim1]);
  await fileReports(victim1, 8);
  const b = await banState(victim1);
  eq(b.type, 'permanent');
  eq(b.ends_at ?? 'null', 'null', 'permanent ban should have no end date');
  eq((await one(
    `select count(*) c from banned_identities
     where hash = encode(sha256(convert_to('vic1@iitb.ac.in','UTF8')),'hex')`)).c, 1, 'identity anchor');
});

console.log('\nModeration — brigades unwind themselves');
const victim2 = await mkUser('vic2');
await check('a brigade of 8 lands a ban', async () => {
  const brigade = await fileReports(victim2, 8);
  eq((await one(`select is_banned($1) b`, [victim2])).b, true);
  globalThis.__brigade = brigade;
});
await check('banning one brigader drops the count and lifts the ban automatically', async () => {
  await db.query(
    `insert into bans (user_id, type, ends_at) values ($1,'temporary', now()+interval '5 days')`,
    [globalThis.__brigade[0]]);
  const b = await banState(victim2);
  if (!b.lifted_at) throw new Error('ban was not lifted');
  eq((await one(`select is_banned($1) b`, [victim2])).b, false, 'victim still banned');
});
await check('the lift records why', async () => {
  const b = await banState(victim2);
  if (!/7 of 8/.test(b.lift_reason ?? '')) throw new Error('unexpected reason: ' + b.lift_reason);
});
await check('a lifted ban does not count toward the 3-strike escalation', async () => {
  const v = await mkUser('vic3');
  const br = await fileReports(v, 8);
  await db.query(`insert into bans (user_id,type,ends_at) values ($1,'temporary',now()+interval '5 days')`, [br[0]]);
  // that ban is now lifted; the next one must still be temporary, not permanent
  await db.query(`update bans set ends_at=now()-interval '1 day' where user_id=$1 and lifted_at is null and ends_at is not null`, [v]);
  await fileReports(v, 8);
  eq((await banState(v)).type, 'temporary', 'escalated on a lifted ban');
});
await check('reports from banned reporters stop counting', async () => {
  const v = await mkUser('vic4');
  const rs = await fileReports(v, 7);
  eq((await one(`select effective_report_count($1) c`, [v])).c, 7);
  await db.query(`insert into bans (user_id,type,ends_at) values ($1,'temporary',now()+interval '5 days')`, [rs[0]]);
  eq((await one(`select effective_report_count($1) c`, [v])).c, 6, 'banned reporter still counted');
});

console.log('\nModeration — appeals');
const appellant = await mkUser('app1');
await check('a banned user can appeal', async () => {
  await fileReports(appellant, 8);
  const banId = (await one(`select id from bans where user_id=$1 order by created_at desc limit 1`, [appellant])).id;
  globalThis.__banId = banId;
  await asUser(appellant, () => db.query(
    `insert into appeals (ban_id, user_id, body) values ($1,$2,'This was a coordinated pile-on, please review.')`,
    [banId, appellant]));
});
await check('only one appeal per ban', () =>
  denied(appellant, `insert into appeals (ban_id, user_id, body) values ($1,$2,'trying again please')`,
    [globalThis.__banId, appellant]));
await check('you cannot appeal someone else’s ban', async () => {
  const nosy = await mkUser('nosy');
  await denied(nosy, `insert into appeals (ban_id, user_id, body) values ($1,$2,'not my ban but here we are')`,
    [globalThis.__banId, nosy]);
});
await check('appellants cannot mark their own appeal overturned', async () => {
  const r = await one(`select count(*) c from information_schema.column_privileges
    where table_name='appeals' and grantee='authenticated' and privilege_type='UPDATE'`);
  eq(r.c, 0);
});
await check('overturning an appeal lifts the ban and releases the anchor', async () => {
  await db.query(`update profiles set college_email='app1@iitb.ac.in' where id=$1`, [appellant]);
  await db.query(`update bans set type='permanent', ends_at=null where id=$1`, [globalThis.__banId]);
  await db.query(
    `insert into banned_identities (hash, kind)
     values (encode(sha256(convert_to('app1@iitb.ac.in','UTF8')),'hex'),'college_email')
     on conflict do nothing`);
  const appealId = (await one(`select id from appeals where ban_id=$1`, [globalThis.__banId])).id;
  await db.query(`select resolve_appeal($1,'overturned')`, [appealId]);
  eq((await one(`select is_banned($1) b`, [appellant])).b, false, 'still banned after overturn');
  eq((await one(`select count(*) c from banned_identities
     where hash = encode(sha256(convert_to('app1@iitb.ac.in','UTF8')),'hex')`)).c, 0, 'anchor not released');
});
await check('moderation internals are not callable by clients', async () => {
  for (const fn of ['evaluate_reports(uuid)', 'effective_report_count(uuid)',
                    'resolve_appeal(uuid,appeal_status)', 'report_ban_threshold()']) {
    eq((await one(`select has_function_privilege('authenticated',$1,'execute') x`, [fn])).x, false, fn);
  }
});

// ---------------------------------------------------------------------------
// Chat inbox
// ---------------------------------------------------------------------------

console.log('\nChat inbox (my_threads)');
const ivy = await mkUser('ivy'), jon = await mkUser('jon'), kip = await mkUser('kip');
await check('an accepted friendship yields a DM thread in the inbox', async () => {
  await asUser(ivy, () => db.query(`insert into friendships (requester_id, addressee_id) values ($1,$2)`, [ivy, jon]));
  await asUser(jon, () => db.query(`update friendships set status='accepted' where addressee_id=$1 and requester_id=$2`, [jon, ivy]));
  const tid = await asUser(ivy, async () => (await db.query(`select open_dm_thread($1) id`, [jon])).rows[0].id);
  await asUser(ivy, () => db.query(
    `insert into messages (thread_id, sender_id, body) values ($1,$2,'first message')`, [tid, ivy]));

  const rows = await asUser(ivy, async () => (await db.query(`select * from my_threads()`)).rows);
  eq(rows.length, 1, 'thread count');
  eq(rows[0].other_id, jon, 'other participant');
  eq(rows[0].last_body, 'first message', 'last message');
  eq(rows[0].type, 'dm');
});
await check('the other participant sees the same thread from their side', async () => {
  const rows = await asUser(jon, async () => (await db.query(`select * from my_threads()`)).rows);
  eq(rows.length, 1);
  eq(rows[0].other_id, ivy, 'other participant should be ivy from jon’s side');
});
await check('an uninvolved user sees nothing', async () => {
  const rows = await asUser(kip, async () => (await db.query(`select * from my_threads()`)).rows);
  eq(rows.length, 0);
});
await check('blocking removes the thread from the inbox for both', async () => {
  await asUser(jon, () => db.query(`insert into blocks (blocker_id, blocked_id) values ($1,$2)`, [jon, ivy]));
  eq((await asUser(ivy, async () => (await db.query(`select * from my_threads()`)).rows)).length, 0, 'blocked side');
  eq((await asUser(jon, async () => (await db.query(`select * from my_threads()`)).rows)).length, 0, 'blocker side');
});
await check('the messages themselves survive a block, for reports', async () => {
  const n = Number((await one(`select count(*) c from messages where body='first message'`)).c);
  eq(n, 1, 'messages should not be deleted by a block');
});

// ---------------------------------------------------------------------------
// Friend discovery
// ---------------------------------------------------------------------------

console.log('\nFriend discovery');
const searcher = await mkUser('searcher');
const findme = await mkUser('findme');
const hidden = await mkUser('hidden');
const search = (uid, q) =>
  asUser(uid, async () => (await db.query(`select * from search_users($1, 20)`, [q])).rows);

await check('username search finds a student', async () => {
  const rows = await search(searcher, 'findme');
  eq(rows.length, 1);
  eq(rows[0].id, findme);
  eq(rows[0].relationship, 'none');
});
await check('search needs at least 2 characters', async () =>
  eq((await search(searcher, 'f')).length, 0));
await check('you appear to yourself as "self", not as a stranger', async () => {
  const rows = await search(searcher, 'searcher');
  eq(rows[0].relationship, 'self');
});
await check('Tier 0 cannot search — that would bypass the enumeration rule', async () => {
  await db.query(`update profiles set trust_tier=0 where id=$1`, [searcher]);
  eq((await search(searcher, 'findme')).length, 0);
  await db.query(`update profiles set trust_tier=2 where id=$1`, [searcher]);
});
await check('search reports a pending request in the right direction', async () => {
  await asUser(searcher, () => db.query(
    `insert into friendships (requester_id, addressee_id) values ($1,$2)`, [searcher, findme]));
  eq((await search(searcher, 'findme'))[0].relationship, 'pending_out');
  eq((await search(findme, 'searcher'))[0].relationship, 'pending_in');
});
await check('both sides see the request, labelled by direction', async () => {
  const mine = await asUser(searcher, async () => (await db.query(`select * from my_friend_requests()`)).rows);
  const theirs = await asUser(findme, async () => (await db.query(`select * from my_friend_requests()`)).rows);
  eq(mine.length, 1); eq(mine[0].direction, 'outgoing'); eq(mine[0].other_id, findme);
  eq(theirs.length, 1); eq(theirs[0].direction, 'incoming'); eq(theirs[0].other_id, searcher);
});
await check('accepting turns it into a friendship', async () => {
  await asUser(findme, () => db.query(
    `update friendships set status='accepted' where addressee_id=$1 and requester_id=$2`, [findme, searcher]));
  eq((await search(searcher, 'findme'))[0].relationship, 'friends');
  const friends = await asUser(searcher, async () => (await db.query(`select * from my_friends()`)).rows);
  eq(friends.length, 1); eq(friends[0].other_id, findme);
  eq(friends[0].thread_id ?? 'null', 'null', 'thread should not exist until someone messages');
});
await check('the friend list picks up the thread once opened', async () => {
  await asUser(searcher, () => db.query(`select open_dm_thread($1)`, [findme]));
  const friends = await asUser(searcher, async () => (await db.query(`select * from my_friends()`)).rows);
  if (!friends[0].thread_id) throw new Error('thread_id still null after opening');
});
await check('blocked users vanish from search and from the friend list', async () => {
  await asUser(hidden, () => db.query(`insert into blocks (blocker_id, blocked_id) values ($1,$2)`, [hidden, searcher]));
  eq((await search(searcher, 'hidden')).length, 0, 'blocker in search results');
});
await check('unverified and banned accounts are not searchable', async () => {
  const t0 = await mkUser('lowtier', { tier: 0 });
  const bad = await mkUser('badactor');
  await db.query(`insert into bans (user_id,type,ends_at) values ($1,'temporary',now()+interval '5 days')`, [bad]);
  eq((await search(searcher, 'lowtier')).length, 0, 'Tier 0 user found');
  eq((await search(searcher, 'badactor')).length, 0, 'banned user found');
});

// ---------------------------------------------------------------------------
// Profile enumeration
// ---------------------------------------------------------------------------

console.log('\nProfile enumeration');
const lurker = await mkUser('lurk', { tier: 0 });
await check('Tier 0 cannot enumerate the directory', () =>
  asUser(lurker, async () => {
    const n = Number((await db.query(`select count(*) c from profiles`)).rows[0].c);
    if (n > 1) throw new Error(`Tier 0 saw ${n} profiles; should only see their own`);
  }));
await check('Tier 0 can still see their own profile', () =>
  asUser(lurker, async () => {
    const n = Number((await db.query(`select count(*) c from profiles where id=$1`, [lurker])).rows[0].c);
    eq(n, 1);
  }));
await check('a verified user can still search the directory', () =>
  asUser(g.gina, async () => {
    const n = Number((await db.query(`select count(*) c from profiles`)).rows[0].c);
    if (n < 2) throw new Error('verified user cannot see other profiles');
  }));
// Pick whichever room actually has messages — earlier tests post into whichever
// room capacity assigned them, which is not necessarily Study 1.
const chattyRoom = (await one(
  `select group_id from group_messages group by group_id order by count(*) desc limit 1`)).group_id;
await check('Tier 0 still gets sender names when reading a group', async () => {
  const room = chattyRoom;
  await asUser(lurker, async () => {
    const rows = (await db.query(`select * from group_thread($1, 50)`, [room])).rows;
    if (!rows.length) throw new Error('no messages returned');
    if (rows.some(r => !r.username && !r.is_blocked)) throw new Error('sender name missing');
  });
});
await check('group_thread collapses blocked senders instead of hiding them', async () => {
  const room = chattyRoom;
  const sender = (await one(`select sender_id from group_messages where group_id=$1 limit 1`, [room])).sender_id;
  const nosy2 = await mkUser('nosy2');
  await asUser(nosy2, () => db.query(`insert into blocks (blocker_id, blocked_id) values ($1,$2)`, [nosy2, sender]));
  await asUser(nosy2, async () => {
    const rows = (await db.query(`select * from group_thread($1, 50)`, [room])).rows;
    const blocked = rows.filter(r => r.sender_id === sender);
    if (!blocked.length) throw new Error('blocked sender vanished entirely');
    for (const r of blocked) {
      eq(r.is_blocked, true, 'is_blocked flag');
      eq(r.body ?? 'null', 'null', 'blocked body should be withheld');
    }
  });
});

// ---------------------------------------------------------------------------
// Notification prefs and account-deletion cascade
// ---------------------------------------------------------------------------

console.log('\nNotification prefs');
await check('signup creates a prefs row', async () =>
  eq((await one(`select count(*) c from notification_prefs where user_id=$1`, [u1.id])).c, 1));
await check('defaults: groups off, the rest on', async () => {
  const r = await one(
    `select dms, friend_requests, connections, groups from notification_prefs where user_id=$1`,
    [u1.id]);
  eq(r.dms, true); eq(r.friend_requests, true); eq(r.connections, true); eq(r.groups, false);
});
await check('owner can change their own prefs', async () => {
  await asUser(u1.id, () =>
    db.query(`update notification_prefs set groups=true where user_id=$1`, [u1.id]));
  eq((await one(`select groups g from notification_prefs where user_id=$1`, [u1.id])).g, true);
});
await check('cannot change someone else\'s prefs', () =>
  noEffect(u1.id, `update notification_prefs set dms=false where user_id=$1`, [u2.id]));
await check('anon has no grants on notification_prefs', async () => {
  const r = await one(`select count(*) c from information_schema.table_privileges
    where table_name='notification_prefs' and grantee='anon'`);
  eq(r.c, 0);
});
await check('deleting a user takes the profile and prefs, not the ban anchor', async () => {
  const { rows: [gone] } = await db.query(
    `insert into auth.users (email) values ('gone@gmail.com') returning id`);
  await db.query(`update profiles set college_email='gone@iitb.ac.in' where id=$1`, [gone.id]);
  const hash = (await one(
    `select encode(sha256(convert_to(lower('gone@iitb.ac.in'),'UTF8')),'hex') h`)).h;
  await db.query(
    `insert into banned_identities (hash, kind) values ($1,'college_email') on conflict do nothing`,
    [hash]);
  await db.query(`delete from auth.users where id=$1`, [gone.id]);
  eq((await one(`select count(*) c from profiles where id=$1`, [gone.id])).c, 0, 'profile leftover');
  eq((await one(`select count(*) c from notification_prefs where user_id=$1`, [gone.id])).c, 0, 'prefs leftover');
  eq((await one(`select count(*) c from banned_identities where hash=$1`, [hash])).c, 1, 'anchor lost');
});

// ---------------------------------------------------------------------------
// Function execute privileges
//
// Postgres grants EXECUTE to PUBLIC by default, unlike tables. These pin that the
// default has been revoked, so safety does not depend on every future function
// remembering to check auth.uid().
// ---------------------------------------------------------------------------

console.log('\nPush tokens and notification honouring');
await check('register stores a token for the caller', async () => {
  await asUser(u1.id, () => db.query(`select register_push_token('ExponentPushToken[testtoken0001]')`));
  eq((await one(`select user_id from push_tokens where token='ExponentPushToken[testtoken0001]'`)).user_id, u1.id);
});
await check('the same token moves to a new caller', async () => {
  await asUser(u2.id, () => db.query(`select register_push_token('ExponentPushToken[testtoken0001]')`));
  eq((await one(`select user_id from push_tokens where token='ExponentPushToken[testtoken0001]'`)).user_id, u2.id);
  eq((await one(`select count(*) c from push_tokens where token='ExponentPushToken[testtoken0001]'`)).c, 1);
});
await check('unregister only removes your own token', async () => {
  await asUser(u1.id, () => db.query(`select register_push_token('ExponentPushToken[testtoken0002]')`));
  await asUser(u2.id, () => db.query(`select unregister_push_token('ExponentPushToken[testtoken0002]')`));
  eq((await one(`select count(*) c from push_tokens where token='ExponentPushToken[testtoken0002]'`)).c, 1, 'stolen unregister');
  await asUser(u1.id, () => db.query(`select unregister_push_token('ExponentPushToken[testtoken0002]')`));
  eq((await one(`select count(*) c from push_tokens where token='ExponentPushToken[testtoken0002]'`)).c, 0);
});
await check('clients have no table grants on push_tokens', async () => {
  const r = await one(`select count(*) c from information_schema.table_privileges
    where table_name='push_tokens' and grantee in ('anon','authenticated')`);
  eq(r.c, 0);
});
await check('should_notify defaults groups off and the rest on', async () => {
  eq((await one(`select should_notify($1,'groups') x`, [u2.id])).x, false);
  eq((await one(`select should_notify($1,'dms') x`, [u2.id])).x, true);
});
await check('should_notify respects a flipped pref', async () => {
  await asUser(u1.id, () => db.query(`update notification_prefs set dms=false where user_id=$1`, [u1.id]));
  eq((await one(`select should_notify($1,'dms') x`, [u1.id])).x, false);
});
await check('should_notify is not client-callable', async () => {
  eq((await one(`select has_function_privilege('authenticated','should_notify(uuid,text)','execute') x`)).x, false);
});

console.log('\nChat images');
const imgA = await mkUser('imga');
const imgB = await mkUser('imgb');
const imgC = await mkUser('imgc');
await asUser(imgA, () =>
  db.query(`insert into friendships (requester_id, addressee_id) values ($1,$2)`, [imgA, imgB]));
await asUser(imgB, () =>
  db.query(`update friendships set status='accepted' where addressee_id=$1`, [imgB]));
const imgThread = (await asUser(imgA, () =>
  one(`select open_dm_thread($1) id`, [imgB]))).id;
await check('chat-images bucket is private and forbids SVG', async () => {
  const r = await one(
    `select public as is_public, allowed_mime_types as mime from storage.buckets where id='chat-images'`);
  eq(r.is_public, false);
  const mime = r.mime ?? [];
  if (mime.includes('image/svg+xml') || mime.includes('image/svg')) {
    throw new Error('SVG is allowed in chat-images');
  }
});
await check('a participant can write a path in their own folder for that thread', async () => {
  const path = `${imgA}/${imgThread}/ok.jpg`;
  eq((await asUser(imgA, () => one(`select can_write_chat_image($1) x`, [path]))).x, true);
});
await check('cannot write into someone else\'s folder', async () => {
  const path = `${imgA}/${imgThread}/stolen.jpg`;
  eq((await asUser(imgB, () => one(`select can_write_chat_image($1) x`, [path]))).x, false);
});
await check('a non-participant cannot upload into that thread', async () => {
  const path = `${imgC}/${imgThread}/intrude.jpg`;
  eq((await asUser(imgC, () => one(`select can_write_chat_image($1) x`, [path]))).x, false);
});
await check('uploader can read their own path before a message exists', async () => {
  const path = `${imgA}/${imgThread}/preview.jpg`;
  eq((await asUser(imgA, () => one(`select can_read_chat_image($1) x`, [path]))).x, true);
});
await check('the other participant can read a path only once a message references it', async () => {
  const path = `${imgA}/${imgThread}/shared.jpg`;
  eq((await asUser(imgB, () => one(`select can_read_chat_image($1) x`, [path]))).x, false, 'before insert');
  await asUser(imgA, () =>
    db.query(`insert into messages (thread_id, sender_id, image_url) values ($1,$2,$3)`,
      [imgThread, imgA, path]));
  eq((await asUser(imgB, () => one(`select can_read_chat_image($1) x`, [path]))).x, true, 'after insert');
});
await check('an outsider cannot read a chat image path', async () => {
  const path = `${imgA}/${imgThread}/shared.jpg`;
  eq((await asUser(imgC, () => one(`select can_read_chat_image($1) x`, [path]))).x, false);
});

console.log('\nFunction execute privileges');
await check('anon can execute nothing in public', async () => {
  const r = await one(`select count(*) c from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.prokind='f'
      and has_function_privilege('anon', p.oid, 'execute')`);
  eq(r.c, 0, 'functions executable by anon');
});
await check('service-role-only functions stay closed to authenticated', async () => {
  for (const fn of ['apply_verification(uuid)', 'hash_email_code(text,text)', 'trips_word_filter(text)']) {
    const r = await one(`select has_function_privilege('authenticated', $1, 'execute') x`, [fn]);
    eq(r.x, false, fn);
  }
});
await check('a newly created function is closed to anon without the sweep', async () => {
  // Migration 22 aims the event trigger at anon, not just PUBLIC, and stops
  // default privileges granting to anon in the first place. This asserts the
  // outcome. It is still not proof of production — pglite was happy with the
  // previous trigger too — so a live anon RPC against a throwaway function is
  // what actually settles it. See LOG.md 2026-08-31.
  await db.exec(`create or replace function public.probe_auto_lock() returns int language sql as $$ select 1 $$`);
  const r = await one(`select has_function_privilege('anon','public.probe_auto_lock()','execute') x`);
  await db.exec(`drop function public.probe_auto_lock()`);
  eq(r.x, false, 'new function was open to anon');
});
await check('the sweep closes a newly created function', async () => {
  await db.exec(`create or replace function public.probe_lockdown() returns int language sql as $$ select 1 $$`);
  await db.exec(`grant execute on function public.probe_lockdown() to anon`);
  await db.query(`select public.lock_client_functions()`);
  const r = await one(`select has_function_privilege('anon','public.probe_lockdown()','execute') x`);
  await db.exec(`drop function public.probe_lockdown()`);
  eq(r.x, false, 'sweep did not close the function');
});
await check('the sweep leaves authenticated grants intact', async () => {
  await db.query(`select public.lock_client_functions()`);
  for (const fn of ['current_tier()', 'search_users(text,integer)', 'my_threads()']) {
    eq((await one(`select has_function_privilege('authenticated',$1,'execute') x`, [fn])).x, true, fn);
  }
});
await check('the functions the app actually calls are still callable', async () => {
  for (const fn of ['current_tier()', 'match_feed(integer)', 'looted_you()', 'looted_you_count()',
                    'join_group(group_category)', 'confirm_college_email(text)', 'open_dm_thread(uuid)',
                    'can_read_chat_image(text)', 'can_write_chat_image(text)',
                    'register_push_token(text)', 'unregister_push_token(text)']) {
    const r = await one(`select has_function_privilege('authenticated', $1, 'execute') x`, [fn]);
    eq(r.x, true, fn);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
await db.close();
process.exit(fail ? 1 : 0);
