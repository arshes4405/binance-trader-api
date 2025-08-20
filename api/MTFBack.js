// CCI + RSI + 볼린저 MTF 백테스팅 시스템 - 바이낸스 실제 데이터
// 설치: npm install axios
// 실행: node backtest.js

const https = require('https');

// 바이낸스 API를 통한 데이터 수집
class BinanceDataFetcher {
    constructor() {
        this.baseUrl = 'api.binance.com';
    }

    // HTTPS 요청 헬퍼 함수
    makeRequest(path) {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: this.baseUrl,
                path: path,
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            };

            const req = https.request(options, (res) => {
                let data = '';
                
                res.on('data', (chunk) => {
                    data += chunk;
                });
                
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(e);
                    }
                });
            });
            
            req.on('error', reject);
            req.end();
        });
    }

    // 히스토리컬 데이터 가져오기
    async fetchHistoricalData(symbol, interval = '1h', limit = 1000) {
        try {
            console.log(`\n${symbol} 데이터 다운로드 중...`);
            
            const allData = [];
            let lastTimestamp = null;
            const maxRequests = 5; // 최대 5번 요청 (5000개 캔들)
            
            for (let i = 0; i < maxRequests; i++) {
                let path = `/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
                if (lastTimestamp) {
                    path += `&endTime=${lastTimestamp - 1}`;
                }
                
                const data = await this.makeRequest(path);
                
                if (data.length === 0) break;
                
                const formattedData = data.map(candle => ({
                    timestamp: candle[0],
                    open: parseFloat(candle[1]),
                    high: parseFloat(candle[2]),
                    low: parseFloat(candle[3]),
                    close: parseFloat(candle[4]),
                    volume: parseFloat(candle[5])
                })).reverse();
                
                allData.unshift(...formattedData);
                lastTimestamp = data[0][0];
                
                console.log(`  - ${(i + 1) * limit}개 캔들 다운로드 완료`);
                
                // API 제한 회피를 위한 딜레이
                await new Promise(resolve => setTimeout(resolve, 200));
            }
            
            console.log(`${symbol} 총 ${allData.length}개 캔들 데이터 수집 완료\n`);
            return allData;
            
        } catch (error) {
            console.error(`데이터 수집 실패 (${symbol}):`, error.message);
            throw error;
        }
    }
}

class TechnicalIndicators {
    // CCI (Commodity Channel Index) 계산
    static calculateCCI(high, low, close, period = 20) {
        const cci = [];
        for (let i = period - 1; i < close.length; i++) {
            const typicalPrices = [];
            for (let j = i - period + 1; j <= i; j++) {
                typicalPrices.push((high[j] + low[j] + close[j]) / 3);
            }
            const avgTP = typicalPrices.reduce((a, b) => a + b, 0) / period;
            const meanDev = typicalPrices.reduce((sum, tp) => sum + Math.abs(tp - avgTP), 0) / period;
            cci.push(meanDev === 0 ? 0 : (typicalPrices[period - 1] - avgTP) / (0.015 * meanDev));
        }
        return cci;
    }

    // RSI (Relative Strength Index) 계산
    static calculateRSI(close, period = 14) {
        const rsi = [];
        let gains = 0, losses = 0;
        
        // 초기 평균 계산
        for (let i = 1; i <= period; i++) {
            const change = close[i] - close[i - 1];
            if (change > 0) gains += change;
            else losses += Math.abs(change);
        }
        
        let avgGain = gains / period;
        let avgLoss = losses / period;
        
        for (let i = period; i < close.length; i++) {
            const change = close[i] - close[i - 1];
            avgGain = (avgGain * (period - 1) + (change > 0 ? change : 0)) / period;
            avgLoss = (avgLoss * (period - 1) + (change < 0 ? Math.abs(change) : 0)) / period;
            
            const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
            rsi.push(100 - (100 / (1 + rs)));
        }
        return rsi;
    }

    // 볼린저 밴드 계산
    static calculateBollingerBands(close, period = 20, multiplier = 2) {
        const bands = { upper: [], middle: [], lower: [] };
        
        for (let i = period - 1; i < close.length; i++) {
            const slice = close.slice(i - period + 1, i + 1);
            const sma = slice.reduce((a, b) => a + b, 0) / period;
            const variance = slice.reduce((sum, val) => sum + Math.pow(val - sma, 2), 0) / period;
            const stdDev = Math.sqrt(variance);
            
            bands.middle.push(sma);
            bands.upper.push(sma + multiplier * stdDev);
            bands.lower.push(sma - multiplier * stdDev);
        }
        return bands;
    }

    // MTF 데이터 변환 (1시간 -> 4시간)
    static convertToHigherTimeframe(data, ratio = 4) {
        const htfData = [];
        for (let i = 0; i < data.length; i += ratio) {
            const slice = data.slice(i, Math.min(i + ratio, data.length));
            if (slice.length > 0) {
                htfData.push({
                    open: slice[0].open,
                    high: Math.max(...slice.map(d => d.high)),
                    low: Math.min(...slice.map(d => d.low)),
                    close: slice[slice.length - 1].close,
                    volume: slice.reduce((sum, d) => sum + d.volume, 0)
                });
            }
        }
        return htfData;
    }
}

class BacktestEngine {
    constructor(data, symbol) {
        this.data = data;
        this.symbol = symbol;
        this.results = [];
    }

    // 진입 신호 체크
    checkEntrySignals(index, conditions, indicators) {
        const signals = {};
        
        // CCI 조건 체크
        if (conditions.cci) {
            if (conditions.cci.type === 'bounce') {
                // -120 돌파 후 -100 재진입
                if (index >= 5 && indicators.cci[index]) {
                    const lookback = 10; // 10봉 이내 확인
                    let touchedMinus120 = false;
                    
                    for (let i = Math.max(0, index - lookback); i < index; i++) {
                        if (indicators.cci[i] && indicators.cci[i] < -120) {
                            touchedMinus120 = true;
                            break;
                        }
                    }
                    
                    signals.cci = touchedMinus120 && 
                                 indicators.cci[index] > -100 && 
                                 indicators.cci[index - 1] <= -100;
                }
            } else {
                // 단순 임계값
                signals.cci = indicators.cci[index] < conditions.cci.threshold;
            }
        }
        
        // RSI 조건 체크
        if (conditions.rsi && indicators.rsi[index]) {
            signals.rsi = indicators.rsi[index] < conditions.rsi.threshold;
        }
        
        // 볼린저 밴드 조건 체크
        if (conditions.bollinger && indicators.bb.lower[index]) {
            const price = this.data[index].close;
            const inCloud = price > indicators.bb.lower[index] && 
                           price < indicators.bb.upper[index];
            signals.bollinger = inCloud;
        }
        
        return signals;
    }

    // 백테스트 실행
    runBacktest(strategy) {
        const { conditions, exitRules, requiredSignals } = strategy;
        
        // 지표 계산
        const close = this.data.map(d => d.close);
        const high = this.data.map(d => d.high);
        const low = this.data.map(d => d.low);
        
        const indicators = {
            cci: TechnicalIndicators.calculateCCI(high, low, close, 20),
            rsi: TechnicalIndicators.calculateRSI(close, 14),
            bb: TechnicalIndicators.calculateBollingerBands(close, 
                conditions.bollinger?.period || 21, 
                conditions.bollinger?.multiplier || 2.0)
        };
        
        // HTF 볼린저 밴드 (4시간)
        if (conditions.bollinger?.useHTF) {
            const htfData = TechnicalIndicators.convertToHigherTimeframe(this.data, 4);
            const htfClose = htfData.map(d => d.close);
            indicators.bbHTF = TechnicalIndicators.calculateBollingerBands(htfClose, 
                conditions.bollinger.period, 
                conditions.bollinger.htfMultiplier || 2.25);
        }
        
        // 백테스트 메트릭스
        const trades = [];
        let inPosition = false;
        let entryPrice = 0;
        let entryIndex = 0;
        let entryTime = null;
        
        // 시작 인덱스 (지표 계산 완료 후)
        const startIndex = Math.max(20, 14) + 1;
        
        for (let i = startIndex; i < this.data.length - 1; i++) {
            if (!inPosition) {
                // 진입 신호 체크
                const signals = this.checkEntrySignals(i, conditions, indicators);
                const activeSignals = Object.values(signals).filter(s => s === true).length;
                const totalSignals = Object.keys(signals).length;
                
                // 필요한 신호 개수 충족 확인
                if (activeSignals >= requiredSignals && totalSignals > 0) {
                    inPosition = true;
                    entryPrice = this.data[i + 1].open; // 다음 봉 시가 진입
                    entryIndex = i + 1;
                    entryTime = new Date(this.data[i + 1].timestamp);
                    
                    trades.push({
                        entryIndex,
                        entryPrice,
                        entryTime: entryTime.toISOString(),
                        signals: { ...signals },
                        activeSignals
                    });
                }
            } else {
                // 청산 조건 체크
                const currentPrice = this.data[i].close;
                const profit = (currentPrice - entryPrice) / entryPrice * 100;
                
                let shouldExit = false;
                
                // 손절/익절 체크
                if (exitRules.stopLoss && profit <= -exitRules.stopLoss) {
                    shouldExit = true;
                    trades[trades.length - 1].exitReason = 'StopLoss';
                } else if (exitRules.takeProfit && profit >= exitRules.takeProfit) {
                    shouldExit = true;
                    trades[trades.length - 1].exitReason = 'TakeProfit';
                } else if (exitRules.holdBars && i - entryIndex >= exitRules.holdBars) {
                    shouldExit = true;
                    trades[trades.length - 1].exitReason = 'TimeExit';
                }
                
                if (shouldExit) {
                    inPosition = false;
                    trades[trades.length - 1].exitIndex = i;
                    trades[trades.length - 1].exitPrice = currentPrice;
                    trades[trades.length - 1].exitTime = new Date(this.data[i].timestamp).toISOString();
                    trades[trades.length - 1].profit = profit;
                    trades[trades.length - 1].holdBars = i - entryIndex;
                }
            }
        }
        
        // 마지막 포지션 청산
        if (inPosition && trades.length > 0) {
            const lastPrice = this.data[this.data.length - 1].close;
            trades[trades.length - 1].exitIndex = this.data.length - 1;
            trades[trades.length - 1].exitPrice = lastPrice;
            trades[trades.length - 1].exitTime = new Date(this.data[this.data.length - 1].timestamp).toISOString();
            trades[trades.length - 1].profit = (lastPrice - entryPrice) / entryPrice * 100;
            trades[trades.length - 1].holdBars = this.data.length - 1 - entryIndex;
            trades[trades.length - 1].exitReason = 'EndOfData';
        }
        
        return this.calculateMetrics(trades, this.data.length);
    }

    // 성과 지표 계산
    calculateMetrics(trades, totalBars) {
        if (trades.length === 0) {
            return {
                totalTrades: 0,
                winRate: 0,
                avgProfit: 0,
                totalReturn: 0,
                maxDrawdown: 0,
                sharpeRatio: 0,
                avgHoldBars: 0,
                tradesPerMonth: 0,
                profitFactor: 0
            };
        }
        
        const wins = trades.filter(t => t.profit > 0);
        const losses = trades.filter(t => t.profit <= 0);
        
        // 누적 수익률 계산
        let cumReturn = 100; // 초기 자본 100%
        let maxCumReturn = 100;
        let maxDrawdown = 0;
        const returns = [];
        
        trades.forEach(trade => {
            cumReturn = cumReturn * (1 + trade.profit / 100);
            returns.push(trade.profit);
            maxCumReturn = Math.max(maxCumReturn, cumReturn);
            const drawdown = ((maxCumReturn - cumReturn) / maxCumReturn) * 100;
            maxDrawdown = Math.max(maxDrawdown, drawdown);
        });
        
        // Sharpe Ratio 계산
        const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
        const stdDev = Math.sqrt(returns.reduce((sum, ret) => 
            sum + Math.pow(ret - avgReturn, 2), 0) / returns.length);
        const sharpeRatio = stdDev === 0 ? 0 : (avgReturn / stdDev) * Math.sqrt(252 / 20); // 연간화
        
        // Profit Factor 계산
        const totalWins = wins.reduce((sum, t) => sum + Math.abs(t.profit), 0);
        const totalLosses = losses.reduce((sum, t) => sum + Math.abs(t.profit), 0);
        const profitFactor = totalLosses === 0 ? totalWins : totalWins / totalLosses;
        
        return {
            totalTrades: trades.length,
            winRate: (wins.length / trades.length * 100).toFixed(2),
            avgProfit: avgReturn.toFixed(2),
            avgWin: wins.length > 0 ? 
                (wins.reduce((sum, t) => sum + t.profit, 0) / wins.length).toFixed(2) : 0,
            avgLoss: losses.length > 0 ? 
                (losses.reduce((sum, t) => sum + t.profit, 0) / losses.length).toFixed(2) : 0,
            totalReturn: ((cumReturn - 100)).toFixed(2),
            maxDrawdown: maxDrawdown.toFixed(2),
            sharpeRatio: sharpeRatio.toFixed(2),
            profitFactor: profitFactor.toFixed(2),
            avgHoldBars: (trades.reduce((sum, t) => sum + t.holdBars, 0) / trades.length).toFixed(1),
            tradesPerMonth: ((trades.length / totalBars) * 720).toFixed(1), // 720 = 30일 * 24시간
            trades: trades.slice(0, 5) // 처음 5개 거래 샘플
        };
    }
}

// 메인 백테스트 실행
async function runCompleteBacktest(symbol = 'BTCUSDT') {
    console.log('='.repeat(70));
    console.log(`CCI + RSI + 볼린저 MTF 백테스팅 분석 - ${symbol}`);
    console.log('='.repeat(70));
    
    try {
        // 바이낸스에서 데이터 가져오기
        const fetcher = new BinanceDataFetcher();
        const data = await fetcher.fetchHistoricalData(symbol, '1h', 1000);
        
        if (!data || data.length === 0) {
            console.error('데이터를 가져올 수 없습니다.');
            return;
        }
        
        const engine = new BacktestEngine(data, symbol);
        
        // 데이터 정보 출력
        const startDate = new Date(data[0].timestamp);
        const endDate = new Date(data[data.length - 1].timestamp);
        console.log(`\n데이터 기간: ${startDate.toLocaleDateString()} ~ ${endDate.toLocaleDateString()}`);
        console.log(`총 캔들 수: ${data.length}개`);
        console.log(`현재 가격: $${data[data.length - 1].close.toFixed(2)}`);
        
        // 1. 3개 조건 모두 만족 vs 2개 조건 만족 비교
        console.log('\n' + '─'.repeat(70));
        console.log('[ 조건 개수별 성능 비교 ]');
        console.log('─'.repeat(70));
        
        const baseConditions = {
            cci: { type: 'bounce' },
            rsi: { threshold: 25 },
            bollinger: { period: 21, multiplier: 2.0, useHTF: true, htfMultiplier: 2.25 }
        };
        
        const exitRules = {
            stopLoss: 3,      // 3% 손절
            takeProfit: 5,    // 5% 익절
            holdBars: 48      // 최대 48시간 보유
        };
        
        // 3개 조건 모두 만족
        const allConditions = engine.runBacktest({
            conditions: baseConditions,
            exitRules,
            requiredSignals: 3
        });
        
        console.log('\n▶ 3개 조건 모두 만족:');
        console.log(`  진입 횟수: ${allConditions.totalTrades}회`);
        console.log(`  승률: ${allConditions.winRate}%`);
        console.log(`  평균 수익률: ${allConditions.avgProfit}%`);
        console.log(`  평균 승리: ${allConditions.avgWin}% | 평균 손실: ${allConditions.avgLoss}%`);
        console.log(`  총 수익률: ${allConditions.totalReturn}%`);
        console.log(`  최대 낙폭: ${allConditions.maxDrawdown}%`);
        console.log(`  Sharpe Ratio: ${allConditions.sharpeRatio}`);
        console.log(`  Profit Factor: ${allConditions.profitFactor}`);
        
        // 2개 조건 만족
        const twoConditions = engine.runBacktest({
            conditions: baseConditions,
            exitRules,
            requiredSignals: 2
        });
        
        console.log('\n▶ 2개 조건 만족:');
        console.log(`  진입 횟수: ${twoConditions.totalTrades}회`);
        console.log(`  승률: ${twoConditions.winRate}%`);
        console.log(`  평균 수익률: ${twoConditions.avgProfit}%`);
        console.log(`  평균 승리: ${twoConditions.avgWin}% | 평균 손실: ${twoConditions.avgLoss}%`);
        console.log(`  총 수익률: ${twoConditions.totalReturn}%`);
        console.log(`  최대 낙폭: ${twoConditions.maxDrawdown}%`);
        console.log(`  Sharpe Ratio: ${twoConditions.sharpeRatio}`);
        console.log(`  Profit Factor: ${twoConditions.profitFactor}`);
        
        // 2. 개별 지표 성능 분석
        console.log('\n' + '─'.repeat(70));
        console.log('[ 개별 지표 파라미터 최적화 ]');
        console.log('─'.repeat(70));
        
        // CCI 비교: 바운스 vs 단순 임계값
        console.log('\n▶ CCI 전략 비교:');
        
        const cciBounce = engine.runBacktest({
            conditions: { cci: { type: 'bounce' } },
            exitRules,
            requiredSignals: 1
        });
        
        const cciSimple = engine.runBacktest({
            conditions: { cci: { type: 'simple', threshold: -100 } },
            exitRules,
            requiredSignals: 1
        });
        
        console.log(`  CCI 바운스 (-120 → -100):`);
        console.log(`    승률: ${cciBounce.winRate}% | 평균수익: ${cciBounce.avgProfit}% | Sharpe: ${cciBounce.sharpeRatio}`);
        console.log(`  CCI 단순 (-100 이하):`);
        console.log(`    승률: ${cciSimple.winRate}% | 평균수익: ${cciSimple.avgProfit}% | Sharpe: ${cciSimple.sharpeRatio}`);
        
        // RSI 임계값 비교
        console.log('\n▶ RSI 임계값 비교:');
        
        const rsiThresholds = [20, 25, 30];
        for (const threshold of rsiThresholds) {
            const result = engine.runBacktest({
                conditions: { rsi: { threshold } },
                exitRules,
                requiredSignals: 1
            });
            console.log(`  RSI ${threshold}:`);
            console.log(`    진입: ${result.totalTrades}회 | 승률: ${result.winRate}% | 평균수익: ${result.avgProfit}%`);
        }
        
        // 볼린저 밴드 파라미터 비교
        console.log('\n▶ 볼린저 밴드 파라미터 비교:');
        
        const bbParams = [
            { period: 20, multiplier: 2.0 },
            { period: 21, multiplier: 2.0 },
            { period: 21, multiplier: 2.25 }
        ];
        
        for (const params of bbParams) {
            const result = engine.runBacktest({
                conditions: { 
                    bollinger: { ...params, useHTF: false }
                },
                exitRules,
                requiredSignals: 1
            });
            console.log(`  BB (${params.period}, ${params.multiplier}):`);
            console.log(`    진입: ${result.totalTrades}회 | 승률: ${result.winRate}% | 평균수익: ${result.avgProfit}%`);
        }
        
        // 3. 조건 조합별 성능
        console.log('\n' + '─'.repeat(70));
        console.log('[ 2개 지표 조합 성능 ]');
        console.log('─'.repeat(70));
        
        // CCI + RSI
        const cciRsi = engine.runBacktest({
            conditions: {
                cci: { type: 'bounce' },
                rsi: { threshold: 25 }
            },
            exitRules,
            requiredSignals: 2
        });
        
        console.log('\n▶ CCI + RSI:');
        console.log(`  진입: ${cciRsi.totalTrades}회 | 승률: ${cciRsi.winRate}%`);
        console.log(`  평균수익: ${cciRsi.avgProfit}% | 총수익: ${cciRsi.totalReturn}%`);
        console.log(`  MDD: ${cciRsi.maxDrawdown}% | Sharpe: ${cciRsi.sharpeRatio} | PF: ${cciRsi.profitFactor}`);
        
        // CCI + 볼린저
        const cciBB = engine.runBacktest({
            conditions: {
                cci: { type: 'bounce' },
                bollinger: { period: 21, multiplier: 2.0 }
            },
            exitRules,
            requiredSignals: 2
        });
        
        console.log('\n▶ CCI + 볼린저:');
        console.log(`  진입: ${cciBB.totalTrades}회 | 승률: ${cciBB.winRate}%`);
        console.log(`  평균수익: ${cciBB.avgProfit}% | 총수익: ${cciBB.totalReturn}%`);
        console.log(`  MDD: ${cciBB.maxDrawdown}% | Sharpe: ${cciBB.sharpeRatio} | PF: ${cciBB.profitFactor}`);
        
        // RSI + 볼린저
        const rsiBB = engine.runBacktest({
            conditions: {
                rsi: { threshold: 25 },
                bollinger: { period: 21, multiplier: 2.0 }
            },
            exitRules,
            requiredSignals: 2
        });
        
        console.log('\n▶ RSI + 볼린저:');
        console.log(`  진입: ${rsiBB.totalTrades}회 | 승률: ${rsiBB.winRate}%`);
        console.log(`  평균수익: ${rsiBB.avgProfit}% | 총수익: ${rsiBB.totalReturn}%`);
        console.log(`  MDD: ${rsiBB.maxDrawdown}% | Sharpe: ${rsiBB.sharpeRatio} | PF: ${rsiBB.profitFactor}`);
        
        // 4. 샘플 거래 내역
        if (allConditions.trades && allConditions.trades.length > 0) {
            console.log('\n' + '─'.repeat(70));
            console.log('[ 샘플 거래 내역 (3개 조건) ]');
            console.log('─'.repeat(70));
            
            allConditions.trades.forEach((trade, idx) => {
                console.log(`\n거래 #${idx + 1}:`);
                console.log(`  진입: ${trade.entryTime.split('T')[0]} | 가격: $${trade.entryPrice.toFixed(2)}`);
                console.log(`  청산: ${trade.exitTime.split('T')[0]} | 가격: $${trade.exitPrice.toFixed(2)}`);
                console.log(`  수익률: ${trade.profit.toFixed(2)}% | 보유: ${trade.holdBars}시간 | 사유: ${trade.exitReason}`);
            });
        }
        
        // 5. 최종 권장사항
        console.log('\n' + '='.repeat(70));
        console.log('[ 분석 결과 요약 및 권장사항 ]');
        console.log('='.repeat(70));
        
        // 최적 조합 찾기
        const combinations = [
            { name: '3개 모두', ...allConditions },
            { name: '2개 조건', ...twoConditions },
            { name: 'CCI+RSI', ...cciRsi },
            { name: 'CCI+BB', ...cciBB },
            { name: 'RSI+BB', ...rsiBB }
        ];
        
        const bestByWinRate = combinations.reduce((a, b) => 
            parseFloat(a.winRate) > parseFloat(b.winRate) ? a : b);
        const bestBySharpe = combinations.reduce((a, b) => 
            parseFloat(a.sharpeRatio) > parseFloat(b.sharpeRatio) ? a : b);
        const bestByProfit = combinations.reduce((a, b) => 
            parseFloat(a.totalReturn) > parseFloat(b.totalReturn) ? a : b);
        
        console.log(`\n📊 성능 요약:`);
        console.log(`  최고 승률: ${bestByWinRate.name} (${bestByWinRate.winRate}%)`);
        console.log(`  최고 Sharpe: ${bestBySharpe.name} (${bestBySharpe.sharpeRatio})`);
        console.log(`  최고 수익률: ${bestByProfit.name} (${bestByProfit.totalReturn}%)`);
        
        console.log('\n✅ 권장사항:');
        
        // 승률과 진입 빈도 균형 평가
        const winRateDiff = Math.abs(parseFloat(allConditions.winRate) - parseFloat(twoConditions.winRate));
        const tradeDiff = twoConditions.totalTrades - allConditions.totalTrades;
        
        if (parseFloat(allConditions.winRate) > 55 && allConditions.totalTrades > 10) {
            console.log('  • 3개 조건 모두 사용 권장 (높은 승률과 안정성)');
        } else if (tradeDiff > allConditions.totalTrades * 0.5 && parseFloat(twoConditions.winRate) > 50) {
            console.log('  • 2개 조건 사용 권장 (적절한 진입 빈도와 승률 균형)');
        } else {
            console.log('  • 시장 상황에 따라 조건 수 조절 권장');
        }
        
        console.log('\n📈 개별 지표 최적 설정:');
        console.log('  • CCI: -120 돌파 후 -100 재진입 (바운스 전략)');
        console.log('  • RSI: 25 임계값 (과매도 구간)');
        console.log('  • 볼린저: 길이 21, 배수 2.0 (1H), HTF 2.25 (4H)');
        
        console.log('\n⚠️  리스크 관리:');
        console.log('  • 손절: -3% (엄격한 리스크 관리)');
        console.log('  • 익절: +5% (리스크 대비 1.67배)');
        console.log('  • 최대 보유: 48시간 (2일)');
        
        console.log('\n' + '='.repeat(70));
        
    } catch (error) {
        console.error('백테스트 실행 중 오류:', error);
    }
}

// 커맨드라인 인자 처리
async function main() {
    const args = process.argv.slice(2);
    let symbol = 'BTCUSDT'; // 기본값
    
    // 심볼 파라미터 체크
    if (args.length > 0) {
        const arg = args[0].toUpperCase();
        if (arg === 'BTC' || arg === 'BTCUSDT') {
            symbol = 'BTCUSDT';
        } else if (arg === 'ETH' || arg === 'ETHUSDT') {
            symbol = 'ETHUSDT';
        } else {
            console.log('사용법: node backtest.js [BTC|ETH]');
            console.log('예시: node backtest.js BTC');
            console.log('예시: node backtest.js ETH');
            return;
        }
    }
    
    console.log('\n백테스팅 시작...');
    console.log(`선택된 심볼: ${symbol}\n`);
    
    await runCompleteBacktest(symbol);
}

// 실행
main().catch(console.error);