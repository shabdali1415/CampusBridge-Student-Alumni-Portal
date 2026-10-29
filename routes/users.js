const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { body } = require('express-validator');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { validate } = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { getPool } = require('../config/db');

const router = express.Router();
router.use(authenticate);
const AVATAR_DIR = path.join(__dirname, '..', 'uploads', 'avatars');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });

// Detect the real image type from magic bytes - never trust the client's filename/MIME.
function sniff(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 6 && /^GIF8[79]a$/.test(buf.slice(0, 6).toString('latin1'))) return 'gif';
  if (buf.length > 12 && buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

async function loadProfile(id) {
  const [rows] = await getPool().execute(
    `SELECT u.id, u.name, u.email, u.role, u.college_id, u.avatar, u.email_verified_at,
            a.graduation_year, a.degree, a.company, a.job_title, a.bio, a.approved_at
     FROM users u LEFT JOIN alumni_profiles a ON a.user_id = u.id WHERE u.id = ?`, [id]);
  const r = rows[0];
  return { id: r.id, name: r.name, email: r.email, role: r.role, collegeId: r.college_id, avatar: r.avatar,
    emailVerified: !!r.email_verified_at,
    alumni: r.role === 'alumni' ? { graduationYear: r.graduation_year, degree: r.degree, company: r.company, jobTitle: r.job_title, bio: r.bio, approved: !!r.approved_at } : null };
}

router.get('/me', asyncHandler(async (req, res) => res.json({ success: true, data: await loadProfile(req.user.id) })));

router.put('/me', validate([
  body('name').trim().isLength({ min: 2, max: 120 }).withMessage('Name must be between 2 and 120 characters.'),
  body('collegeId').optional({ values: 'falsy' }).trim().isLength({ max: 40 }).withMessage('College ID is too long.'),
  body('graduationYear').optional({ values: 'falsy' }).isInt({ min: 1950, max: 2100 }).withMessage('Enter a valid graduation year.').toInt(),
  body('degree').optional({ values: 'falsy' }).trim().isLength({ max: 120 }),
  body('company').optional({ values: 'falsy' }).trim().isLength({ max: 150 }),
  body('jobTitle').optional({ values: 'falsy' }).trim().isLength({ max: 150 }),
  body('bio').optional({ values: 'falsy' }).trim().isLength({ max: 500 }).withMessage('Bio can be at most 500 characters.'),
]), asyncHandler(async (req, res) => {
  const b = req.body;
  await getPool().execute(`UPDATE users SET name = ?, college_id = ? WHERE id = ?`, [b.name, b.collegeId || null, req.user.id]);
  if (req.user.role === 'alumni') {
    await getPool().execute(
      `UPDATE alumni_profiles SET graduation_year = ?, degree = ?, company = ?, job_title = ?, bio = ? WHERE user_id = ?`,
      [b.graduationYear || null, b.degree || null, b.company || null, b.jobTitle || null, b.bio || null, req.user.id]);
  }
  res.json({ success: true, message: 'Profile saved.', data: await loadProfile(req.user.id) });
}));

router.post('/me/avatar', upload.single('avatar'), asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('Choose an image to upload.');
  const ext = sniff(req.file.buffer);
  if (!ext) throw ApiError.badRequest('Only JPEG, PNG, GIF or WebP images are allowed.', 'BAD_IMAGE');
  for (const f of fs.readdirSync(AVATAR_DIR)) if (f.startsWith(`u${req.user.id}.`)) fs.unlinkSync(path.join(AVATAR_DIR, f));
  const name = `u${req.user.id}.${ext}`;
  fs.writeFileSync(path.join(AVATAR_DIR, name), req.file.buffer);
  const url = `/uploads/avatars/${name}?v=${Date.now()}`;
  await getPool().execute(`UPDATE users SET avatar = ? WHERE id = ?`, [url, req.user.id]);
  res.json({ success: true, message: 'Profile picture updated.', data: { avatar: url } });
}));

module.exports = router;
