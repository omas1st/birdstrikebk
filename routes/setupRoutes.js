const express = require('express');
const router = express.Router();
const { getSetups, addSetup, deleteSetup } = require('../controllers/setupController');

router.get('/', getSetups);
router.post('/', addSetup);
router.delete('/:id', deleteSetup);

module.exports = router;