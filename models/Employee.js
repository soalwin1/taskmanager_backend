import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const Employee = sequelize.define('Employee', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  fullName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    validate: { isEmail: true }
  },
  phone: {
    type: DataTypes.STRING,
    allowNull: false
  },
  department: {
    type: DataTypes.ENUM('IT', 'HR', 'Sales'),
    allowNull: true
  },
  designation: {
    type: DataTypes.STRING,
    allowNull: false
  },
  password: {
    type: DataTypes.STRING,
    allowNull: false
  },
  role: {
    type: DataTypes.ENUM('user', 'admin'),
    defaultValue: 'user'
  },
  canCreateTasks: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  profilePicture: {
    type: DataTypes.STRING,
    defaultValue: ''
  },
  resetPasswordToken: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: null
  },
  resetPasswordExpires: {
    type: DataTypes.DATE,
    allowNull: true,
    defaultValue: null
  },
  otp: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: null
  },
  otpExpires: {
    type: DataTypes.DATE,
    allowNull: true,
    defaultValue: null
  },
  mfaType: {
    type: DataTypes.ENUM('email', 'totp'),
    defaultValue: 'email'
  },
  mfaSecret: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: null
  },
  mfaSecretTemp: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: null
  }
}, {
  tableName: 'employees',
  timestamps: true // adds createdAt and updatedAt automatically
});

export default Employee;
