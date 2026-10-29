// Creates the database/tables and (on an empty database) loads demo data.
//   npm run db:setup     -> create tables + seed if empty
//   npm run db:reset     -> DROP and recreate everything
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const { env } = require('../config/env');

const DAY = 86400000;
const at = (days, h, m = 0) => { const d = new Date(Date.now() + days * DAY); d.setHours(h, m, 0, 0); return d; };

async function main() {
  const reset = process.argv.includes('--reset');
  const conn = await mysql.createConnection({ host: env.db.host, port: env.db.port, user: env.db.user, password: env.db.password, multipleStatements: true });
  const db = env.db.name;
  if (reset) await conn.query(`DROP DATABASE IF EXISTS \`${db}\``);
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8').replace(/student_portal/g, db);
  await conn.query(schema);
  await conn.query(`USE \`${db}\``);

  const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM users');
  if (n > 0) { console.log('[db] Tables ready (data already present, seed skipped).'); return conn.end(); }

  const now = new Date();
  const adminHash = await bcrypt.hash('Admin@123', 12);
  const pwHash = await bcrypt.hash('Passw0rd!', 12);
  const user = async (name, email, role, cid, hash, verified = true) =>
    (await conn.execute(`INSERT INTO users (name, email, password_hash, role, college_id, email_verified_at) VALUES (?,?,?,?,?,?)`,
      [name, email, hash, role, cid, verified ? now : null]))[0].insertId;

  const admin = await user('Portal Administrator', 'admin@college.edu', 'admin', 'ADMIN-001', adminHash);
  const students = {};
  for (const [k, name, cid] of [['aarav', 'Aarav Mehta', 'CS2024-001'], ['diya', 'Diya Nair', 'EC2024-014'], ['vikram', 'Vikram Iyer', 'CS2022-045'],
    ['sara', 'Sara Khan', 'IT2025-006'], ['rohan', 'Rohan Gupta', 'ME2023-021']]) students[k] = await user(name, `${k}.student@example.com`, 'student', cid, pwHash);

  const alumni = {};
  const A = [
    ['meera', 'Meera Joshi', 'CS2018-087', 2018, 'M.Tech Computer Science', 'Infosys', 'Data Science Lead', 'Building analytics teams. I run a monthly data hackathon.', true],
    ['ananya', 'Ananya Sharma', 'CS2015-071', 2015, 'B.Tech Computer Science', 'Google', 'Senior Software Engineer', 'Back to help with interview prep and open source mentoring.', true],
    ['karthik', 'Karthik Rao', 'EC2012-033', 2012, 'B.Tech Electronics', 'Intel', 'Hardware Architect', 'VLSI and embedded systems. Happy to review resumes.', true],
    ['daniel', 'Daniel Fernandes', 'ME2010-001', 2010, 'B.Tech Mechanical', 'L&T', 'Project Manager', 'Manufacturing and operations. Open to internship referrals.', true],
    ['priya', 'Priya Menon', 'IT2018-086', 2018, 'B.Tech Information Technology', 'Zoho', 'Product Analyst', 'Product and UX. Would love to give guest talks.', false],
    ['rahul', 'Rahul Verma', 'CS2021-104', 2021, 'B.Tech Computer Science', 'Startup Labs', 'Founding Engineer', 'Early stage startup life. Looking to hire interns.', false],
  ];
  for (const [k, name, cid, yr, deg, co, title, bio, approved] of A) {
    const id = await user(name, `${k}.alum@example.com`, 'alumni', cid, pwHash);
    alumni[k] = id;
    await conn.execute(`INSERT INTO alumni_profiles (user_id, graduation_year, degree, company, job_title, bio, approved_at) VALUES (?,?,?,?,?,?,?)`,
      [id, yr, deg, co, title, bio, approved ? now : null]);
  }

  const E = [
    ['Cricket Practice Match', 'Friendly fixture ahead of the inter-college tournament.', 'sports', 'Lower Ground', at(1, 10), 30],
    ['Yoga & Wellness Morning', 'Start the day right with a guided session open to everyone.', 'sports', 'Sports Complex', at(2, 7, 30), 60],
    ['Robotics Prototype Workshop', 'Build and program a line-following robot. Materials provided, bring your laptop.', 'workshop', 'Innovation Lab', at(3, 16), 2],
    ['Data Structures Refresher', 'Crack the basics before placement season starts.', 'workshop', 'Computer Lab 1', at(4, 9, 30), 50],
    ['Inter-College Football Finals', 'Cheer for the home side in the championship decider.', 'sports', 'Central Ground', at(5, 10, 30), 400],
    ['Resume & Interview Clinic', 'Alumni review your resume one-to-one and run mock interviews.', 'career', 'Seminar Hall B', at(6, 8, 30), 45],
    ['Debate: Technology & Society', 'Parliamentary-style debate on AI, privacy and the future of work.', 'general', 'Auditorium', at(7, 17, 30), 70],
    ['Cultural Night: Rhythm & Roots', 'An evening of music, dance and food stalls from across campus.', 'cultural', 'Open Air Theatre', at(8, 19), 300],
    ['Photography Walk', 'Golden-hour walk around the old campus with a pro photographer.', 'cultural', 'Main Gate', at(9, 17), 25],
    ['Annual Tech Symposium 2026', 'Keynotes, project expo and recruiter booths.', 'career', 'Convention Centre', at(10, 9), 250],
    ['24-hour Hackathon', 'Build something useful for campus life in 24 hours.', 'workshop', 'Innovation Lab', at(12, 10), 120],
    ['Alumni Meet & Greet', 'Meet graduates from every batch over high tea.', 'career', 'Faculty Lounge', at(14, 16), 150],
    ['Open Mic Night', 'Poetry, stand-up and acoustic sets. Sign up to perform.', 'cultural', 'Student Cafe', at(16, 18, 30), 80],
    ['Basketball Tournament', 'Three-on-three knockout for all departments.', 'sports', 'Indoor Court', at(18, 9), 100],
  ];
  const ev = [];
  for (const e of E) ev.push((await conn.execute(`INSERT INTO events (title, description, category, venue, starts_at, capacity, created_by) VALUES (?,?,?,?,?,?,?)`, [...e, admin]))[0].insertId);

  const reg = (e, u, s, mins) => conn.execute(`INSERT INTO registrations (event_id, user_id, status, registered_at) VALUES (?,?,?,?)`, [ev[e], u, s, new Date(now.getTime() - mins * 60000)]);
  await reg(2, students.aarav, 'confirmed', 600); await reg(2, students.diya, 'confirmed', 500);
  await reg(2, students.vikram, 'waitlisted', 400); await reg(2, students.sara, 'waitlisted', 300);
  await reg(0, students.aarav, 'cancelled', 200); await reg(1, students.vikram, 'confirmed', 100);
  await reg(3, students.rohan, 'confirmed', 90); await reg(5, students.sara, 'confirmed', 80); await reg(5, students.diya, 'confirmed', 70);
  await reg(7, students.diya, 'confirmed', 60); await reg(6, students.rohan, 'confirmed', 50);

  const N = [['Library extends hours during exam week', 'The central library stays open until midnight from Monday.'],
    ['Placement drive: 20 companies visiting campus', 'Register on the placement cell page before Friday.'],
    ['Semester registration opens on Monday', 'Fee payment and course selection close in two weeks.']];
  for (const [i, [t, b]] of N.entries()) await conn.execute(`INSERT INTO news (title, body, author_id, created_at) VALUES (?,?,?,?)`, [t, b, admin, new Date(now.getTime() - i * 3600000)]);

  const J = [['Data Science Intern', 'Infosys', 'Pune / Remote', 'internship', 'Work with the analytics team on forecasting models. Python and SQL required.', null, 'meera'],
    ['Graduate Hardware Engineer', 'Intel', 'Hyderabad', 'full_time', 'Join the validation team for next-generation chips. Strong digital design fundamentals.', 25, 'karthik'],
    ['Software Engineering Intern (Summer 2027)', 'Google', 'Bengaluru', 'internship', 'Twelve-week internship working on production systems with a mentor.', 40, 'ananya']];
  for (const [t, c, l, ty, d, dl, by] of J)
    await conn.execute(`INSERT INTO jobs (title, company, location, job_type, description, deadline, posted_by, created_at) VALUES (?,?,?,?,?,?,?,?)`,
      [t, c, l, ty, d, dl ? at(dl, 23, 59) : null, alumni[by], now]);

  console.log('[db] Schema created and demo data loaded.');
  console.log('[db] Admin login   : admin@college.edu / Admin@123');
  console.log('[db] Demo accounts : aarav.student@example.com, meera.alum@example.com ... / Passw0rd!');
  await conn.end();
}
main().catch((e) => { console.error('[db] Setup failed:', e.code || '', e.message); process.exit(1); });
