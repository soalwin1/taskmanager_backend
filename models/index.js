/**
 * models/index.js
 * 
 * Central place to define all Sequelize model associations (foreign keys).
 * Import this file once in server.js AFTER all models are loaded.
 */

import Employee from './Employee.js';
import Task from './Task.js';
import Notification from './Notification.js';
import DesignationPermission from './DesignationPermission.js';
import ChatMessage from './ChatMessage.js';

// ── Task ↔ Employee ──────────────────────────────────────────────────────────
// A Task belongs to one Employee; an Employee has many Tasks.
// This creates the `employeeId` FK column on the tasks table.
Employee.hasMany(Task, { foreignKey: 'employeeId', as: 'tasks', onDelete: 'CASCADE' });
Task.belongsTo(Employee, { foreignKey: 'employeeId', as: 'employee' });

// ── Notification ↔ Employee ──────────────────────────────────────────────────
// A Notification belongs to one Employee; an Employee has many Notifications.
Employee.hasMany(Notification, { foreignKey: 'employeeId', as: 'notifications', onDelete: 'CASCADE' });
Notification.belongsTo(Employee, { foreignKey: 'employeeId', as: 'employee' });

// ── Notification ↔ Task (optional) ──────────────────────────────────────────
// A Notification may optionally reference a Task.
Task.hasMany(Notification, { foreignKey: 'taskId', as: 'notifications', onDelete: 'SET NULL' });
Notification.belongsTo(Task, { foreignKey: 'taskId', as: 'task' });

// ── ChatMessage ↔ Employee ──────────────────────────────────────────────────
// A ChatMessage is sent by an Employee and received by an Employee.
Employee.hasMany(ChatMessage, { foreignKey: 'senderId', as: 'sentMessages', onDelete: 'CASCADE' });
ChatMessage.belongsTo(Employee, { foreignKey: 'senderId', as: 'sender' });

Employee.hasMany(ChatMessage, { foreignKey: 'receiverId', as: 'receivedMessages', onDelete: 'CASCADE' });
ChatMessage.belongsTo(Employee, { foreignKey: 'receiverId', as: 'receiver' });

export { Employee, Task, Notification, DesignationPermission, ChatMessage };
