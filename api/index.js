// vercel/api/index.js - 사용자별 즐겨찾기 + 시세포착 관리

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
      // ===== 기존 즐겨찾기 액션들 =====
      case 'getFavoriteCoins':
        if (method === 'GET') {
          const { username } = query;
          
          if (!username) {
            return res.status(400).json({ success: false, message: 'Username is required' });
          }

          const coins = await db.collection('favorite_coins').find({ username }).toArray();
          return res.status(200).json(coins);
        }
        break;

      case 'addFavoriteCoin':
        if (method === 'GET') {
          const { username, symbol } = query;
          
          if (!username || !symbol) {
            return res.status(400).json({ 
              success: false, 
              message: 'Username and symbol are required' 
            });
          }

          const existingCoin = await db.collection('favorite_coins').findOne({ 
            username, 
            symbol 
          });
          
          if (existingCoin) {
            return res.status(400).json({ 
              success: false, 
              message: 'Coin already exists for this user' 
            });
          }

          const newCoin = {
            username,
            symbol,
            addedAt: new Date().toISOString()
          };
          
          await db.collection('favorite_coins').insertOne(newCoin);
          return res.status(201).json({ 
            success: true, 
            data: newCoin, 
            message: 'Coin added successfully' 
          });
        }
        break;

      case 'removeFavoriteCoin':
        if (method === 'GET') {
          const { username, symbol } = query;
          
          if (!username || !symbol) {
            return res.status(400).json({ 
              success: false, 
              message: 'Username and symbol are required' 
            });
          }

          const result = await db.collection('favorite_coins').deleteOne({ 
            username, 
            symbol 
          });
          
          if (result.deletedCount > 0) {
            return res.status(200).json({ 
              success: true, 
              message: 'Coin removed successfully' 
            });
          } else {
            return res.status(404).json({ 
              success: false, 
              message: 'Coin not found for this user' 
            });
          }
        }
        break;

      // ===== 사용자 관리 액션들 =====
      case 'saveUserSettings':
        if (method === 'GET') {
          const { username, email, password, createdAt } = query;
          
          if (!username || !email || !password) {
            return res.status(400).json({ 
              success: false, 
              message: 'Username, email, and password are required' 
            });
          }

          const existingUser = await db.collection('user_settings').findOne({ username });
          if (existingUser) {
            return res.status(400).json({ 
              success: false, 
              message: 'Username already exists' 
            });
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
            return res.status(400).json({ 
              success: false, 
              message: 'Username is required' 
            });
          }

          const user = await db.collection('user_settings').findOne({ username });
          
          if (user) {
            return res.status(200).json({ success: true, data: user });
          } else {
            return res.status(404).json({ 
              success: false, 
              message: 'User not found' 
            });
          }
        }
        break;

      // ===== 🆕 시세포착 관련 액션들 =====
      case 'saveSignalConfig':
        if (method === 'GET') {
          const { 
            username, 
            signalType, 
            symbol, 
            timeframe, 
            checkInterval, 
            cciPeriod, 
            cciBreakoutValue, 
            cciEntryValue, 
            seedMoney, 
            isActive 
          } = query;
          
          if (!username || !signalType || !symbol || !timeframe) {
            return res.status(400).json({ 
              success: false, 
              message: 'Username, signalType, symbol, and timeframe are required' 
            });
          }

          // 기존 설정이 있는지 확인 (username + signalType + symbol + timeframe 조합으로 중복 체크)
          const existingConfig = await db.collection('signal_configs').findOne({ 
            username, 
            signalType, 
            symbol, 
            timeframe 
          });

          const configData = {
            username,
            signalType,
            symbol,
            timeframe,
            checkInterval: parseInt(checkInterval) || 900, // 기본 15분
            cciPeriod: parseInt(cciPeriod) || 20,
            cciBreakoutValue: parseFloat(cciBreakoutValue) || 100.0,
            cciEntryValue: parseFloat(cciEntryValue) || 90.0,
            seedMoney: parseFloat(seedMoney) || 1000.0,
            isActive: isActive === 'true',
            updatedAt: new Date().toISOString()
          };

          if (existingConfig) {
            // 기존 설정 업데이트
            await db.collection('signal_configs').updateOne(
              { _id: existingConfig._id },
              { $set: configData }
            );
            
            return res.status(200).json({ 
              success: true, 
              data: { ...configData, _id: existingConfig._id },
              message: 'Signal config updated successfully' 
            });
          } else {
            // 새 설정 생성
            configData.createdAt = new Date().toISOString();
            const result = await db.collection('signal_configs').insertOne(configData);
            
            return res.status(201).json({ 
              success: true, 
              data: { ...configData, _id: result.insertedId },
              message: 'Signal config saved successfully' 
            });
          }
        }
        break;

      case 'getSignalConfigs':
        if (method === 'GET') {
          const { username } = query;
          
          if (!username) {
            return res.status(400).json({ 
              success: false, 
              message: 'Username is required' 
            });
          }

          const configs = await db.collection('signal_configs').find({ username }).toArray();
          
          return res.status(200).json({ 
            success: true, 
            data: configs,
            message: 'Signal configs retrieved successfully' 
          });
        }
        break;

      case 'saveSignal':
        if (method === 'GET') {
          const { 
            configId,
            username, 
            symbol, 
            signalType, 
            direction, 
            price, 
            volume, 
            cciValue, 
            cciBreakoutValue, 
            cciEntryValue, 
            reason, 
            timeframe 
          } = query;
          
          if (!username || !symbol || !signalType || !direction) {
            return res.status(400).json({ 
              success: false, 
              message: 'Username, symbol, signalType, and direction are required' 
            });
          }

          const signalData = {
            configId: configId || '',
            username,
            symbol,
            signalType,
            direction,
            price: parseFloat(price) || 0.0,
            volume: parseFloat(volume) || 0.0,
            cciValue: parseFloat(cciValue) || 0.0,
            cciBreakoutValue: parseFloat(cciBreakoutValue) || 0.0,
            cciEntryValue: parseFloat(cciEntryValue) || 0.0,
            reason: reason || '',
            timeframe: timeframe || '15m',
            status: 'ACTIVE',
            isRead: false,
            timestamp: new Date().toISOString()
          };

          const result = await db.collection('signals').insertOne(signalData);
          
          return res.status(201).json({ 
            success: true, 
            data: { ...signalData, _id: result.insertedId },
            message: 'Signal saved successfully' 
          });
        }
        break;

      case 'getSignals':
        if (method === 'GET') {
          const { username, limit } = query;
          
          if (!username) {
            return res.status(400).json({ 
              success: false, 
              message: 'Username is required' 
            });
          }

          const limitCount = parseInt(limit) || 50;
          
          const signals = await db.collection('signals')
            .find({ username })
            .sort({ timestamp: -1 })  // 최신 순으로 정렬
            .limit(limitCount)
            .toArray();
          
          return res.status(200).json({ 
            success: true, 
            data: signals,
            message: 'Signals retrieved successfully' 
          });
        }
        break;

      default:
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid action' 
        });
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