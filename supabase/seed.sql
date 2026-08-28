-- Looty — local development seed
--
-- ############################################################################
-- ##  UNVERIFIED SAMPLE DATA — DO NOT SHIP TO PRODUCTION                    ##
-- ############################################################################
--
-- The domains below are plausible but have NOT been confirmed. Confirming them is
-- exactly the Phase 0 work described in CONTEXT.md §7, and it cannot be done from
-- a text file — for each college you must establish:
--
--   1. Do students actually receive mailboxes? (Many Indian colleges issue none,
--      or issue them only to staff, or only to certain departments.)
--   2. The exact domain AND subdomain. Staff and students are often split, e.g.
--      @xyz.ac.in vs @student.xyz.ac.in. List each one separately — no wildcards,
--      or @alumni.xyz.ac.in gets in too.
--   3. Roughly what share of students have one. A college where 20% of students
--      have mail is a college where the ID card path carries almost all signups.
--
-- A wrong domain here is worse than a missing one: a missing domain sends the
-- student down the ID path, but a wrong domain hands Tier 2 to the wrong people.

insert into public.colleges (name, city, state) values
  ('Indian Institute of Technology Bombay',  'Mumbai',    'Maharashtra'),
  ('Indian Institute of Technology Madras',  'Chennai',   'Tamil Nadu'),
  ('Indian Institute of Technology Delhi',   'New Delhi', 'Delhi'),
  ('Birla Institute of Technology and Science, Pilani', 'Pilani', 'Rajasthan'),
  ('Vellore Institute of Technology',        'Vellore',   'Tamil Nadu')
on conflict do nothing;

-- Deliberately left empty. Populate only with domains verified per the checklist
-- above; every row added here grants instant Tier 2 to everyone on that domain.
--
-- insert into public.college_domains (college_id, domain)
-- select id, 'iitb.ac.in' from public.colleges where name like 'Indian Institute of Technology Bombay';
