const mongoose = require('mongoose');

const tradeSchema = new mongoose.Schema(
  {
    date: {
      type: Date,
      required: true,
    },
    pair: {
      type: String,
      required: true,
    },
    strategy: {
      type: String,
      required: true,
    },
    outcome: {
      type: String,
      enum: ['win', 'loss'],
      required: true,
    },
    reason: {
      type: String,
      default: 'A+ setup',
    },
    entered: {
      type: Boolean,
      default: true,   // true = trade was entered live
    },
  },
  { timestamps: true }
);

// Indexes for performance
tradeSchema.index({ date: 1 });
tradeSchema.index({ pair: 1 });
tradeSchema.index({ strategy: 1 });
tradeSchema.index({ outcome: 1 });
tradeSchema.index({ date: 1, pair: 1, strategy: 1, outcome: 1 });

module.exports = mongoose.model('Trade', tradeSchema);