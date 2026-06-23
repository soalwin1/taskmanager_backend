import { Sequelize } from 'sequelize';

const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres',
  logging: false,
  pool: {
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000
  },
  dialectOptions: {
    // Needed if connecting to PostgreSQL over SSL (e.g., cloud providers)
    ssl: { require: true, rejectUnauthorized: false }
  }
});

export default sequelize;
