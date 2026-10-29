const express = require('express');
const { query } = require('express-validator');
const asyncHandler = require('../utils/asyncHandler');
const { validate } = require('../middleware/validate');
const { getPool } = require('../config/db');

const router = express.Router();
router.get('/', validate([
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('pageSize').optional().isInt({ min: 1, max: 50 }).toInt(),
]), asyncHandler(async (req, res) => {
  const limit = req.query.pageSize || 10, page = req.query.page || 1;
  const [[{ total }]] = await getPool().execute(`SELECT COUNT(*) AS total FROM news`);
  const [rows] = await getPool().query(
    `SELECT n.id, n.title, n.body, n.created_at, u.name AS author FROM news n LEFT JOIN users u ON u.id = n.author_id
     ORDER BY n.created_at DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`);
  res.json({ success: true, data: { items: rows.map((r) => ({ id: r.id, title: r.title, body: r.body, author: r.author || 'College Office', createdAt: r.created_at })),
    page, total, totalPages: Math.max(1, Math.ceil(total / limit)) } });
}));
module.exports = router;
