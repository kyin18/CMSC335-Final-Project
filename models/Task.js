const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema({
  activity: { type: String, required: true },
  city: { type: String, required: true },
  state: String,
  country: { type: String, required: true },
  taskDate: { type: Date, required: true },
  taskTime: String,
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Task', taskSchema);