import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const DesignationPermission = sequelize.define('DesignationPermission', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  designation: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  canCreateTasks: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  canEditTasks: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  canDeleteTasks: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  canAccessUserDirectory: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  canAccessApprovals: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  canAccessAnalytics: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  }
}, {
  tableName: 'designation_permissions',
  timestamps: true
});

export default DesignationPermission;
