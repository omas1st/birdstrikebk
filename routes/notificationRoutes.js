const express = require('express');
const router = express.Router();
const {
  getNotifications,
  markRead,
  markAllRead,
} = require('../controllers/notificationController');

router.get('/', getNotifications);
router.put('/:id/read', markRead);
router.put('/read-all', markAllRead);

module.exports = router;