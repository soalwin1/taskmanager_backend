import express from 'express';
import { Op } from 'sequelize';
import Employee from '../models/Employee.js';
import ChatMessage from '../models/ChatMessage.js';
import auth from '../middleware/auth.js';

const router = express.Router();

// @route   GET /api/chat/contacts
// @desc    Get all chat contacts in the logged-in user's department
// @access  Private
router.get('/contacts', auth, async (req, res) => {
  try {
    const loggedInUser = req.user;
    
    let whereClause;
    if (loggedInUser.role === 'admin') {
      whereClause = {
        id: { [Op.ne]: loggedInUser.id }
      };
    } else {
      whereClause = {
        [Op.or]: [
          { department: loggedInUser.department },
          { role: 'admin' }
        ],
        id: { [Op.ne]: loggedInUser.id }
      };
    }

    // Fetch matching users
    const contacts = await Employee.findAll({
      where: whereClause,
      attributes: ['id', 'fullName', 'email', 'department', 'designation', 'profilePicture'],
      order: [['fullName', 'ASC']]
    });

    // For each contact, count the number of unread messages sent to the logged-in user
    const formattedContacts = [];
    for (const contact of contacts) {
      const unreadCount = await ChatMessage.count({
        where: {
          senderId: contact.id,
          receiverId: loggedInUser.id,
          read: false
        }
      });
      
      formattedContacts.push({
        ...contact.toJSON(),
        unreadCount
      });
    }

    res.json(formattedContacts);
  } catch (err) {
    console.error('Error fetching chat contacts:', err);
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
});

// @route   GET /api/chat/messages/:contactId
// @desc    Get chat message history with a contact and mark incoming messages as read
// @access  Private
router.get('/messages/:contactId', auth, async (req, res) => {
  try {
    const { contactId } = req.params;
    const loggedInUserId = req.user.id;

    // Fetch message history ordered chronologically
    const messages = await ChatMessage.findAll({
      where: {
        [Op.or]: [
          { senderId: loggedInUserId, receiverId: contactId },
          { senderId: contactId, receiverId: loggedInUserId }
        ]
      },
      order: [['createdAt', 'ASC']]
    });

    // Mark any unread messages from this contact to the logged-in user as read
    await ChatMessage.update(
      { read: true },
      {
        where: {
          senderId: contactId,
          receiverId: loggedInUserId,
          read: false
        }
      }
    );

    res.json(messages);
  } catch (err) {
    console.error('Error fetching chat messages:', err);
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
});

// @route   POST /api/chat/messages
// @desc    Send a new chat message
// @access  Private
router.post('/messages', auth, async (req, res) => {
  try {
    const { receiverId, message } = req.body;
    const senderId = req.user.id;

    if (!receiverId || !message || !message.trim()) {
      return res.status(400).json({ message: 'Recipient and message content are required' });
    }

    // Validate if the receiver is in the same department
    const sender = await Employee.findByPk(senderId);
    const receiver = await Employee.findByPk(receiverId);

    if (!receiver) {
      return res.status(404).json({ message: 'Recipient not found' });
    }

    if (sender.role !== 'admin' && receiver.role !== 'admin' && sender.department !== receiver.department) {
      return res.status(403).json({ message: 'Cannot chat with users from a different department' });
    }

    const chatMessage = await ChatMessage.create({
      senderId,
      receiverId,
      message: message.trim()
    });

    // Emit message to recipient in real-time
    if (req.io) {
      req.io.to(`user_${receiverId}`).emit('new_chat_message', chatMessage);
    }

    res.status(201).json(chatMessage);
  } catch (err) {
    console.error('Error sending chat message:', err);
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
});

// @route   PUT /api/chat/messages/:contactId/read
// @desc    Mark all messages from a contact as read
// @access  Private
router.put('/messages/:contactId/read', auth, async (req, res) => {
  try {
    const { contactId } = req.params;
    const loggedInUserId = req.user.id;

    await ChatMessage.update(
      { read: true },
      {
        where: {
          senderId: contactId,
          receiverId: loggedInUserId,
          read: false
        }
      }
    );

    res.json({ message: 'Messages marked as read' });
  } catch (err) {
    console.error('Error marking messages as read:', err);
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
});

export default router;
