const express = require('express');
const router = express.Router();
const { getFinalAnalysis } = require('../controllers/finalAnalysisController');

router.get('/', getFinalAnalysis);

module.exports = router;