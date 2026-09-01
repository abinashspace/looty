# College domain candidates

> **Do not paste these into `college_domains` until a human confirms students
> actually get mailboxes on that exact string.** A wrong domain hands full
> access to anyone with an address on it. A missing domain only leaves that
> college read-only.
>
> Already **live and confirmed:** `thangavelu.edu.in` (Thangavelu Engineering
> College, Chennai — owner holds a mailbox). Probe only: `looty.test.invalid`.
>
> Tick `ok` / `no` / `unknown`. Exact domains only — no `*.college.ac.in`.
> Staff vs student subdomains must be listed separately.

Status: `unconfirmed` unless marked otherwise.

## Owner / first launch

| College | Domain | Status | Notes |
|---|---|---|---|
| Thangavelu Engineering College, Chennai | `thangavelu.edu.in` | **live** | Owner confirmed 2026-09-01. Address shape: rollnumber@thangavelu.edu.in |

## IITs (often Google Workspace)

| College | Likely domain(s) | Status | Check |
|---|---|---|---|
| IIT Bombay | `iitb.ac.in`, `student.iitb.ac.in` | unconfirmed | Students historically `@iitb.ac.in`. Confirm current student vs alumni/staff. |
| IIT Delhi | `iitd.ac.in` | unconfirmed | |
| IIT Madras | `smail.iitm.ac.in`, `iitm.ac.in` | unconfirmed | Many batches use `smail.iitm.ac.in`. Do **not** wildcard `iitm.ac.in` if staff/alumni differ. |
| IIT Kanpur | `iitk.ac.in` | unconfirmed | |
| IIT Kharagpur | `iitkgp.ac.in`, `kgpian.iitkgp.ac.in` | unconfirmed | |
| IIT Roorkee | `iitr.ac.in` | unconfirmed | |
| IIT Guwahati | `iitg.ac.in` | unconfirmed | |
| IIT Hyderabad | `iith.ac.in` | unconfirmed | |
| IIT BHU | `itbhu.ac.in`, `iitbhu.ac.in` | unconfirmed | |
| IIT Gandhinagar | `iitgn.ac.in` | unconfirmed | |

## NITs / IIITs (sample)

| College | Likely domain(s) | Status | Check |
|---|---|---|---|
| NIT Trichy | `nitt.edu` | unconfirmed | |
| NITK Surathkal | `nitk.edu.in` | unconfirmed | |
| NIT Warangal | `nitw.ac.in` | unconfirmed | |
| NIT Calicut | `nitc.ac.in` | unconfirmed | |
| IIIT Hyderabad | `iiit.ac.in`, `students.iiit.ac.in` | unconfirmed | |

## BITS / large private

| College | Likely domain(s) | Status | Check |
|---|---|---|---|
| BITS Pilani (all campuses) | `pilani.bits-pilani.ac.in`, `goa.bits-pilani.ac.in`, `hyderabad.bits-pilani.ac.in` | unconfirmed | Campus-specific. No wildcard on `bits-pilani.ac.in`. |
| VIT Vellore | `vitstudent.ac.in`, `vit.ac.in` | unconfirmed | Student vs staff split is common. |
| SRM | `srmist.edu.in` | unconfirmed | |
| Manipal (MAHE) | `learner.manipal.edu`, `manipal.edu` | unconfirmed | |
| Amrita | `am.students.amrita.edu` / campus variants | unconfirmed | Confirm per campus. |
| Anna University CEG | `student.annauniv.edu` | unconfirmed | Affiliated colleges often have **no** mailbox — that is the reach problem. |

## How to confirm (cannot be done from this repo)

For each row, a student (or the college site / handbook) must answer:

1. Do undergraduates get a mailbox at all?
2. The **exact** domain on the From: line of a real student message.
3. Is there a different domain for staff / alumni / old batches?

If (1) is no, skip the college. Request-a-college in the app is the queue.

When a row is `ok`, add it on live with:

```sql
insert into colleges (name, city, state) values ('…','…','…');
insert into college_domains (college_id, domain)
select id, 'exact.domain.here' from colleges where name = '…';
```

Never a migration of “all IITs guessed”.
