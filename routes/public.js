'use strict';
// Public pages: home, category, pro profile.
const express = require('express');
const { db } = require('../db');

const router = express.Router();

// Home: category grid + 4 most recent pros.
router.get('/', (req, res) => {
  const categories = db.prepare('SELECT * FROM categories ORDER BY sort_order').all();
  const featuredPros = db.prepare('SELECT * FROM pro_profiles ORDER BY id DESC LIMIT 4').all();
  res.render('index', { pageTitle: 'Find someone to help', categories, featuredPros });
});

// Category page: pros offering services in this category.
router.get('/c/:id', (req, res) => {
  const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!category) {
    return res.status(404).render('error', {
      pageTitle: 'Not found',
      message: 'Sorry, that category does not exist.'
    });
  }
  const pros = db.prepare(
    `SELECT DISTINCT pp.* FROM pro_profiles pp
     JOIN services s ON s.pro_id = pp.id
     WHERE s.category_id = ?
     ORDER BY pp.id DESC`
  ).all(category.id);
  const svcByPro = db.prepare(
    'SELECT * FROM services WHERE pro_id = ? AND category_id = ? ORDER BY id'
  );
  pros.forEach((p) => {
    p.services = svcByPro.all(p.id, category.id);
  });
  res.render('category', { pageTitle: category.name, category, pros });
});

// Public pro profile: business info, services, photos.
router.get('/pro/:id', (req, res) => {
  const pro = db.prepare('SELECT * FROM pro_profiles WHERE id = ?').get(req.params.id);
  if (!pro) {
    return res.status(404).render('error', {
      pageTitle: 'Not found',
      message: 'Sorry, that pro was not found.'
    });
  }
  const services = db.prepare(
    `SELECT s.*, c.name AS category_name FROM services s
     JOIN categories c ON c.id = s.category_id
     WHERE s.pro_id = ? ORDER BY s.id`
  ).all(pro.id);
  const photos = db.prepare('SELECT * FROM photos WHERE pro_id = ? ORDER BY id').all(pro.id);
  res.render('pro-public', { pageTitle: pro.business_name, pro, services, photos });
});

module.exports = router;
