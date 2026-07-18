const express = require('express');
const router = express.Router();
const { recordTrade, getTrades } = require('../controllers/tradeController');

router.post('/', recordTrade);
router.get('/', getTrades);

module.exports = router;