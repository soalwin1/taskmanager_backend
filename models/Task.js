import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const Task = sequelize.define('Task', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  title: {
    type: DataTypes.STRING,
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  priority: {
    type: DataTypes.ENUM('High', 'Medium', 'Low'),
    allowNull: false,
    defaultValue: 'Medium'
  },
  dueDate: {
    type: DataTypes.DATE,
    allowNull: false
  },
  status: {
    type: DataTypes.ENUM('Pending', 'In Review', 'Completed', 'Rejected'),
    allowNull: false,
    defaultValue: 'Pending'
  },
  // employeeId FK is defined in models/index.js via associations
  adminRemark: {
    type: DataTypes.STRING,
    defaultValue: ''
  }
}, {
  tableName: 'tasks',
  timestamps: true
});

export default Task;
