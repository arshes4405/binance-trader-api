// vercel/api/index.js - DB 기반 돌파 상태 관리 시스템 적용

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
      // ===== 기존 즐겨찾기 관리 =====
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
            message: 'Coin added to favorites' 
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
          
          if (result.deletedCount === 0) {
            return res.status(404).json({ 
              success: false, 
              message: 'Coin not found in favorites' 
            });
          }

          return res.status(200).json({ 
            success: true, 
            message: 'Coin removed from favorites' 
          });
        }
        break;

      // ===== 시세포착 설정 관리 =====
      case 'saveSignalConfig':
        if (method === 'GET') {
          const { 
            username, signalType, symbol, timeframe, checkInterval, 
            cciPeriod, cciBreakoutValue, cciEntryValue, seedMoney, isActive 
          } = query;
          
          if (!username || !symbol || !signalType) {
            return res.status(400).json({ 
              success: false, 
              message: 'Username, symbol, and signalType are required' 
            });
          }

          const configId = `${username}_${symbol}_${timeframe}_${Date.now()}`;
          const configData = {
            configId,
            username,
            signalType,
            symbol,
            timeframe,
            checkInterval: parseInt(checkInterval) || 300,
            cciPeriod: parseInt(cciPeriod) || 20,
            cciBreakoutValue: parseFloat(cciBreakoutValue) || 100.0,
            cciEntryValue: parseFloat(cciEntryValue) || 90.0,
            seedMoney: parseFloat(seedMoney) || 1000.0,
            isActive: isActive === 'true',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };

          await db.collection('signal_configs').insertOne(configData);
          return res.status(200).json({ 
            success: true, 
            data: configData,
            message: 'Signal config saved successfully' 
          });
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

      case 'updateSignalConfig':
        if (method === 'GET') {
          const { configId, isActive } = query;
          
          if (!configId) {
            return res.status(400).json({ 
              success: false, 
              message: 'ConfigId is required' 
            });
          }

          const updateData = {
            updatedAt: new Date().toISOString()
          };

          if (isActive !== undefined) {
            updateData.isActive = isActive === 'true';
          }

          const result = await db.collection('signal_configs').updateOne(
            { configId },
            { $set: updateData }
          );

          return res.status(200).json({ 
            success: true, 
            message: result.modifiedCount > 0 ? 'Config updated successfully' : 'No config found to update' 
          });
        }
        break;

      case 'deleteSignalConfig':
        if (method === 'GET') {
          const { configId } = query;
          
          if (!configId) {
            return res.status(400).json({ 
              success: false, 
              message: 'ConfigId is required' 
            });
          }

          // 설정과 관련된 상태도 함께 삭제
          await db.collection('breakout_states').deleteMany({ configId });
          const result = await db.collection('signal_configs').deleteOne({ configId });

          return res.status(200).json({ 
            success: true, 
            message: result.deletedCount > 0 ? 'Config deleted successfully' : 'No config found to delete' 
          });
        }
        break;

      // ===== 시세포착 신호 관리 =====
      case 'saveSignal':
        if (method === 'GET') {
          const { 
            configId, username, symbol, signalType, direction, 
            price, volume, cciValue, cciBreakoutValue, cciEntryValue, 
            reason, timeframe 
          } = query;
          
          if (!configId || !username || !symbol) {
            return res.status(400).json({ 
              success: false, 
              message: 'ConfigId, username, and symbol are required' 
            });
          }

          const signalData = {
            signalId: `${configId}_${Date.now()}`,
            configId,
            username,
            symbol,
            signalType,
            direction,
            price: parseFloat(price) || 0.0,
            volume: parseFloat(volume) || 0.0,
            cciValue: parseFloat(cciValue) || 0.0,
            cciBreakoutValue: parseFloat(cciBreakoutValue) || 100.0,
            cciEntryValue: parseFloat(cciEntryValue) || 90.0,
            reason,
            timeframe,
            status: 'ACTIVE',
            isRead: false,
            createdAt: new Date().toISOString()
          };

          await db.collection('market_signals').insertOne(signalData);
          return res.status(200).json({ 
            success: true, 
            data: signalData,
            message: 'Signal saved successfully' 
          });
        }
        break;

      case 'getSignals':
        if (method === 'GET') {
          const { username } = query;
          
          if (!username) {
            return res.status(400).json({ 
              success: false, 
              message: 'Username is required' 
            });
          }

          const signals = await db.collection('market_signals')
            .find({ username })
            .sort({ createdAt: -1 })
            .toArray();

          return res.status(200).json({ 
            success: true, 
            data: signals,
            message: 'Signals retrieved successfully' 
          });
        }
        break;

      case 'markSignalAsRead':
        if (method === 'GET') {
          const { signalId } = query;
          
          if (!signalId) {
            return res.status(400).json({ 
              success: false, 
              message: 'SignalId is required' 
            });
          }

          const result = await db.collection('market_signals').updateOne(
            { signalId },
            { $set: { isRead: true, updatedAt: new Date().toISOString() } }
          );

          return res.status(200).json({ 
            success: true, 
            message: result.modifiedCount > 0 ? 'Signal marked as read' : 'No signal found' 
          });
        }
        break;

      // ===== DB 기반 돌파 상태 관리 시스템 =====
      case 'saveBreakoutState':
        if (method === 'GET') {
          const { 
            configId, 
            username, 
            symbol, 
            currentState, 
            lastCciValue, 
            breakoutValue, 
            entryValue 
          } = query;
          
          if (!configId || !username || !symbol || !currentState) {
            return res.status(400).json({ 
              success: false, 
              message: 'ConfigId, username, symbol, and currentState are required' 
            });
          }

          const stateData = {
            configId,
            username,
            symbol,
            currentState, // NO_BREAKOUT, LONG_BREAKOUT, SHORT_BREAKOUT
            lastCciValue: parseFloat(lastCciValue) || 0.0,
            breakoutValue: parseFloat(breakoutValue) || 100.0,
            entryValue: parseFloat(entryValue) || 90.0,
            lastCheckTime: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };

          // 기존 상태가 있으면 업데이트, 없으면 생성
          const result = await db.collection('breakout_states').replaceOne(
            { configId: configId },
            stateData,
            { upsert: true }
          );
          
          return res.status(200).json({ 
            success: true, 
            data: stateData,
            message: 'Breakout state saved successfully' 
          });
        }
        break;

      case 'getBreakoutState':
        if (method === 'GET') {
          const { configId } = query;
          
          if (!configId) {
            return res.status(400).json({ 
              success: false, 
              message: 'ConfigId is required' 
            });
          }

          const state = await db.collection('breakout_states').findOne({ configId });
          
          if (state) {
            return res.status(200).json({ 
              success: true, 
              data: state,
              message: 'Breakout state retrieved successfully' 
            });
          } else {
            return res.status(200).json({ 
              success: true, 
              data: null,
              message: 'No breakout state found' 
            });
          }
        }
        break;

      case 'getAllBreakoutStates':
        if (method === 'GET') {
          const { username } = query;
          
          if (!username) {
            return res.status(400).json({ 
              success: false, 
              message: 'Username is required' 
            });
          }

          const states = await db.collection('breakout_states').find({ username }).toArray();
          
          return res.status(200).json({ 
            success: true, 
            data: states,
            message: 'All breakout states retrieved successfully' 
          });
        }
        break;

      case 'deleteBreakoutState':
        if (method === 'GET') {
          const { configId } = query;
          
          if (!configId) {
            return res.status(400).json({ 
              success: false, 
              message: 'ConfigId is required' 
            });
          }

          const result = await db.collection('breakout_states').deleteOne({ configId });
          
          return res.status(200).json({ 
            success: true, 
            message: result.deletedCount > 0 ? 'Breakout state deleted successfully' : 'No state found to delete' 
          });
        }
        break;

// index.js의 switch 문에 추가할 사용자 관련 API

      // ===== 사용자 관리 =====
      case 'saveUserSettings':
        if (method === 'GET') {
          const { username, email, password, createdAt } = query;
          
          if (!username || !email || !password) {
            return res.status(400).json({ 
              success: false, 
              message: 'Username, email, and password are required' 
            });
          }

          // 기존 사용자 확인
          const existingUser = await db.collection('user_settings').findOne({ 
            $or: [
              { username: username },
              { email: email }
            ]
          });
          
          if (existingUser) {
            return res.status(400).json({ 
              success: false, 
              message: existingUser.username === username ? 
                'Username already exists' : 'Email already exists'
            });
          }

          const userData = {
            username,
            email,
            password, // 이미 해시된 상태로 전달됨
            createdAt: createdAt || new Date().toISOString()
          };
          
          const result = await db.collection('user_settings').insertOne(userData);
          
          return res.status(201).json({ 
            success: true, 
            data: {
              _id: result.insertedId.toString(),
              username: userData.username,
              email: userData.email,
              createdAt: userData.createdAt
            },
            message: 'User created successfully' 
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
            // MongoDB ObjectId를 문자열로 변환
            const userData = {
              _id: user._id.toString(),
              username: user.username,
              email: user.email,
              password: user.password,
              createdAt: user.createdAt
            };
            
            return res.status(200).json({ 
              success: true, 
              data: userData,
              message: 'User found successfully' 
            });
          } else {
            return res.status(404).json({ 
              success: false, 
              message: 'User not found' 
            });
          }
        }
        break;

      // 기존 사용자 업데이트 (필요시)
      case 'updateUserSettings':
        if (method === 'GET') {
          const { username, email, password } = query;
          
          if (!username) {
            return res.status(400).json({ 
              success: false, 
              message: 'Username is required' 
            });
          }

          const updateData = {
            updatedAt: new Date().toISOString()
          };

          if (email) updateData.email = email;
          if (password) updateData.password = password;

          const result = await db.collection('user_settings').updateOne(
            { username },
            { $set: updateData }
          );

          if (result.matchedCount === 0) {
            return res.status(404).json({ 
              success: false, 
              message: 'User not found' 
            });
          }

          return res.status(200).json({ 
            success: true, 
            message: 'User updated successfully' 
          });
        }
        break;

      // 사용자 삭제 (필요시)
      case 'deleteUser':
        if (method === 'GET') {
          const { username } = query;
          
          if (!username) {
            return res.status(400).json({ 
              success: false, 
              message: 'Username is required' 
            });
          }

          // 사용자와 관련된 모든 데이터 삭제
          await db.collection('favorite_coins').deleteMany({ username });
          await db.collection('signal_configs').deleteMany({ username });
          await db.collection('market_signals').deleteMany({ username });
          await db.collection('breakout_states').deleteMany({ username });
          
          const result = await db.collection('user_settings').deleteOne({ username });

          if (result.deletedCount === 0) {
            return res.status(404).json({ 
              success: false, 
              message: 'User not found' 
            });
          }

          return res.status(200).json({ 
            success: true, 
            message: 'User and all related data deleted successfully' 
          });
        }
        break;

      // ===== 기본 응답 =====
      default:
        return res.status(400).json({ 
          success: false, 
          message: `Unknown action: ${action}` 
        });
    }
  } catch (error) {
    console.error('API 오류:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Internal server error',
      error: error.message 
    });
  } finally {
    // MongoDB 연결을 여기서 닫지 않음 (Vercel의 연결 재사용을 위해)
  }
};