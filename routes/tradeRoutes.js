const express = require('express');
const router = express.Router();
const { recordTrade, getTrades, updateTrade, deleteTrade } = require('../controllers/tradeController');

router.post('/', recordTrade);
router.get('/', getTrades);
router.put('/:id', updateTrade);   // <-- new
router.delete('/:id', deleteTrade);

module.exports = router;