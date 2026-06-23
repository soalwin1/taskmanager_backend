import sequelize from './config/database.js';
import Employee from './models/Employee.js';
import dotenv from 'dotenv';
dotenv.config();

async function promote() {
  try {
    await sequelize.authenticate();
    console.log('Connected to PostgreSQL');
    
    // Find the first user or a specific user and make them an admin
    // You can also change this to search by email: { where: { email: 'your@email.com' } }
    const user = await Employee.findOne();
    
    if (!user) {
      console.log('No users found in the database. Please register a user first.');
      process.exit(0);
    }

    user.role = 'admin';
    await user.save();

    console.log(`Successfully promoted ${user.fullName} (${user.email}) to Admin!`);
    console.log('Please log out and log back in to refresh your token.');
  } catch (error) {
    console.error('Error promoting to admin:', error);
  } finally {
    await sequelize.close();
  }
}

promote();
