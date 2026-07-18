const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    message: {
      type: String,
      required: true,
    },
    read: {
      type: Boolean,
      default: false,
    },
    // Unique identifier to avoid duplicate notifications
    identifier: {
      type: String,
      unique: true,
      sparse: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Notification', notificationSchema);