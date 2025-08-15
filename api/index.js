const mongoose = require('mongoose');

// MongoDB 연결
const connectDB = async () => {
  if (mongoose.connections[0].readyState) {
    return;
  }
  
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('MongoDB connected');
  } catch (error) {
    console.error('MongoDB connection error:', error);
  }
};

// 즐겨찾기 코인 스키마
const FavoriteCoinSchema = new mongoose.Schema({
  symbol: { type: String, required: true },
  addedAt: { type: Date, default: Date.now }
});

// 수정 후
const FavoriteCoin = mongoose.models.FavoriteCoin || mongoose.model('FavoriteCoin', FavoriteCoinSchema, 'favorite_coins');

// 사용자 설정 스키마
const UserSettingsSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  binanceApiKey: String,
  binanceSecretKey: String,
  preferences: {
    defaultCoins: [String],
    notifications: Boolean,
    theme: String
  },
  updatedAt: { type: Date, default: Date.now }
});

const UserSettings = mongoose.models.UserSettings || mongoose.model('UserSettings', UserSettingsSchema);

// CORS 헤더 설정
const setCorsHeaders = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
};

// 메인 핸들러
module.exports = async (req, res) => {
  setCorsHeaders(res);
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  await connectDB();

  const { method, query, body } = req;
  const { action } = query;

  try {
    switch (action) {
      case 'getFavoriteCoins':
        if (method === 'GET') {
          const coins = await FavoriteCoin.find().sort({ addedAt: -1 });
          return res.status(200).json({ success: true, data: coins });
        }
        break;

      case 'addFavoriteCoin':
        if (method === 'POST') {
          const { symbol } = body;
          
          // 중복 체크
          const existingCoin = await FavoriteCoin.findOne({ symbol });
          if (existingCoin) {
            return res.status(400).json({ success: false, message: 'Coin already exists' });
          }
          
          const newCoin = new FavoriteCoin({ symbol });
          await newCoin.save();
          return res.status(201).json({ success: true, data: newCoin });
        }
        break;

      case 'removeFavoriteCoin':
        if (method === 'DELETE') {
          const { symbol } = body;
          await FavoriteCoin.deleteOne({ symbol });
          return res.status(200).json({ success: true, message: 'Coin removed' });
        }
        break;

      case 'getUserSettings':
        if (method === 'GET') {
          const { userId } = query;
          const settings = await UserSettings.findOne({ userId });
          return res.status(200).json({ success: true, data: settings });
        }
        break;

      case 'updateUserSettings':
        if (method === 'POST') {
          const { userId, ...settingsData } = body;
          const settings = await UserSettings.findOneAndUpdate(
            { userId },
            { ...settingsData, updatedAt: new Date() },
            { upsert: true, new: true }
          );
          return res.status(200).json({ success: true, data: settings });
        }
        break;

      default:
        return res.status(400).json({ success: false, message: 'Invalid action' });
    }
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};