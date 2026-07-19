const express = require('express');
const router = express.Router();
const { recordTrade, getTrades, deleteTrade } = require('../controllers/tradeController');

router.post('/', recordTrade);
router.get('/', getTrades);
router.delete('/:id', deleteTrade);

module.exports = router;