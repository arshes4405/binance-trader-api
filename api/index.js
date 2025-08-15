// vercel/api/index.js - GET 방식을 지원하도록 수정

const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI;
const client = new MongoClient(MONGODB_URI);

module.exports = async (req, res) => {
  // CORS 헤더 설정
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // OPTIONS 요청 처리 (CORS preflight)
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    await client.connect();
    const db = client.db('binance_trader');
    
    const { method } = req;
    const { action } = method === 'GET' ? req.query : req.body;
    const query = req.query;
    const body = req.body;

    console.log(`API 호출: ${method} ${action}`, { query, body });

    switch (action) {
      case 'getFavoriteCoins':
        if (method === 'GET') {
          const coins = await db.collection('favorite_coins').find({}).toArray();
          return res.status(200).json(coins); // 직접 배열 반환
        }
        break;

      case 'addFavoriteCoin':
        if (method === 'GET') {
          // GET 방식으로 코인 추가
          const { symbol } = query;
          
          if (!symbol) {
            return res.status(400).json({ success: false, message: 'Symbol is required' });
          }

          // 중복 체크
          const existingCoin = await db.collection('favorite_coins').findOne({ symbol });
          if (existingCoin) {
            return res.status(400).json({ success: false, message: 'Coin already exists' });
          }

          const newCoin = {
            symbol,
            addedAt: new Date().toISOString()
          };
          
          await db.collection('favorite_coins').insertOne(newCoin);
          return res.status(201).json({ success: true, data: newCoin, message: 'Coin added successfully' });
        }
        break;

      case 'removeFavoriteCoin':
        if (method === 'GET') {
          // GET 방식으로 코인 삭제
          const { symbol } = query;
          
          if (!symbol) {
            return res.status(400).json({ success: false, message: 'Symbol is required' });
          }

          const result = await db.collection('favorite_coins').deleteOne({ symbol });
          
          if (result.deletedCount > 0) {
            return res.status(200).json({ success: true, message: 'Coin removed successfully' });
          } else {
            return res.status(404).json({ success: false, message: 'Coin not found' });
          }
        }
        break;

      case 'saveUserSettings':
        if (method === 'GET') {
          // GET 방식으로 사용자 설정 저장
          const { username, email, password, createdAt } = query;
          
          if (!username || !email || !password) {
            return res.status(400).json({ 
              success: false, 
              message: 'Username, email, and password are required' 
            });
          }

          // 중복 사용자 체크
          const existingUser = await db.collection('user_settings').findOne({ username });
          if (existingUser) {
            return res.status(400).json({ success: false, message: 'Username already exists' });
          }

          const newUser = {
            username,
            email,
            password,
            createdAt: createdAt || new Date().toISOString()
          };

          const result = await db.collection('user_settings').insertOne(newUser);
          
          return res.status(201).json({ 
            success: true, 
            data: { _id: result.insertedId, ...newUser }, 
            message: 'User settings saved successfully' 
          });
        }
        break;

      case 'getUserSettings':
        if (method === 'GET') {
          const { username } = query;
          
          if (!username) {
            return res.status(400).json({ success: false, message: 'Username is required' });
          }

          const user = await db.collection('user_settings').findOne({ username });
          
          if (user) {
            return res.status(200).json({ success: true, data: user });
          } else {
            return res.status(404).json({ success: false, message: 'User not found' });
          }
        }
        break;

      default:
        return res.status(400).json({ success: false, message: 'Invalid action' });
    }

    // method가 맞지 않는 경우
    return res.status(405).json({ 
      success: false, 
      message: `Method ${method} not allowed for action ${action}` 
    });

  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error', 
      error: error.message 
    });
  } finally {
    await client.close();
  }
};