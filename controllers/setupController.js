const Setup = require('../models/Setup');

// Get all active setups
exports.getSetups = async (req, res) => {
  try {
    const setups = await Setup.find({ isActive: true });
    res.json(setups);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Add a setup (or reactivate if inactive)
exports.addSetup = async (req, res) => {
  try {
    const { pair, strategy } = req.body;
    if (!pair || !strategy) {
      return res.status(400).json({ error: 'Pair and strategy are required' });
    }

    // Check if an inactive setup exists
    let setup = await Setup.findOne({ pair, strategy, isActive: false });

    if (setup) {
      // Reactivate it
      setup.isActive = true;
      setup.restoredAt = new Date();
      await setup.save();
      return res.status(200).json(setup);
    }

    // Check if already active
    const exists = await Setup.findOne({ pair, strategy, isActive: true });
    if (exists) {
      return res.status(400).json({ error: 'Setup already exists' });
    }

    // Create new active setup
    setup = new Setup({ pair, strategy });
    await setup.save();
    res.status(201).json(setup);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Delete a setup (set inactive)
exports.deleteSetup = async (req, res) => {
  try {
    const setup = await Setup.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    );
    if (!setup) return res.status(404).json({ error: 'Setup not found' });
    res.json({ message: 'Setup deleted (deactivated)' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};