import express from 'express';
import Notification from '../models/Notification.js';
import auth from '../middleware/auth.js';

const router = express.Router();

// @route   GET /api/user/notifications
// @desc    Get notifications for the logged-in employee
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const notifications = await Notification.findAll({
      where: { employeeId: req.user.id },
      order: [['createdAt', 'DESC']],
      limit: 50
    });
    res.json(notifications);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
});

// @route   PUT /api/user/notifications/:id/read
// @desc    Mark a single notification as read
// @access  Private
router.put('/:id/read', auth, async (req, res) => {
  try {
    const notification = await Notification.findByPk(req.params.id);
    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    if (notification.employeeId !== req.user.id) {
      return res.status(401).json({ message: 'Not authorized' });
    }

    await notification.update({ read: true });
    res.json(notification);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
});

// @route   PUT /api/user/notifications/read-all
// @desc    Mark all notifications as read for the logged-in employee
// @access  Private
router.put('/read-all', auth, async (req, res) => {
  try {
    await Notification.update(
      { read: true },
      { where: { employeeId: req.user.id, read: false } }
    );
    res.json({ message: 'All notifications marked as read' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
});

export default router;
