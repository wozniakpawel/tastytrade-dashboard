// Main data processing function
function processTradeData(data) {
    // Helper function to parse dates consistently
    function parseDate(dateStr) {
        if (!dateStr) return new Date();
        dateStr = dateStr.trim();
        
        // Handle YYYY-MM-DD format
        if (dateStr.includes('-')) {
            return new Date(dateStr);
        }
        
        // Handle MM/DD/YYYY format
        const [month, day, year] = dateStr.split('/');
        if (month && day && year) {
            return new Date(year, parseInt(month) - 1, day);
        }
        
        // Fallback
        return new Date(dateStr);
    }

    // Helper function to clean currency values
    function parseCurrency(str) {
        if (!str) return 0;
        if (typeof str === 'number') return str;
        // Remove currency symbol, commas, and whitespace, handle negative values
        const cleanStr = str.replace(/[$,\s]/g, '');
        return parseFloat(cleanStr) || 0;
    }

    // Process each row
    const processedData = data.map(row => {
        try {
            const processedRow = {
                ...row,
                CLOSE_DATE: parseDate(row.CLOSE_DATE),
                OPEN_DATE: parseDate(row.OPEN_DATE),
                TOTAL_GAINLOSS: parseCurrency(row.NO_WS_GAINLOSS),
                NO_WS_PROCEEDS: parseCurrency(row.NO_WS_PROCEEDS),
                NO_WS_GAINLOSS: parseCurrency(row.NO_WS_GAINLOSS),
                NO_WS_COST: parseCurrency(row.NO_WS_COST),
                QUANTITY: parseInt(row.QUANTITY) || 0
            };
            return processedRow;
        } catch (error) {
            console.error('Error processing row:', row, error);
            return null;
        }
    }).filter(row => row !== null);

    // Sort chronologically
    processedData.sort((a, b) => a.CLOSE_DATE - b.CLOSE_DATE);

    // Calculate additional metrics
    let cumulativePnL = 0;
    return processedData.map(row => {
        // Holding period in days
        const holdingPeriod = Math.max(0, (row.CLOSE_DATE - row.OPEN_DATE) / (1000 * 60 * 60 * 24));
        
        // Cumulative P&L using NO_WS_GAINLOSS
        cumulativePnL += row.TOTAL_GAINLOSS;
        
        // Calculate ROI (avoid division by zero)
        const roi = row.NO_WS_COST !== 0 ? (row.TOTAL_GAINLOSS / Math.abs(row.NO_WS_COST)) * 100 : 0;

        // Option symbol parsing
        let underlying = row.SYMBOL;
        let optionType = null;
        let strike = null;
        const symbolMatch = row.SYMBOL.match(/(\w+)--(\d+)([CP])(\d+)/);
        if (symbolMatch) {
            [, underlying, , optionType, strike] = symbolMatch;
            strike = parseFloat(strike) / 1000;
        }

        return {
            ...row,
            HOLDING_PERIOD: holdingPeriod,
            CUMULATIVE_PNL: cumulativePnL,
            ROI: roi,
            UNDERLYING: underlying,
            OPTION_TYPE: optionType,
            STRIKE: strike
        };
    });
}

// Create all plots
function createPlots(data) {
    const plotsContainer = document.getElementById('plotsContainer');
    plotsContainer.innerHTML = '';

    // 1. Cumulative P&L Over Time
    createPlot({
        x: data.map(d => d.CLOSE_DATE),
        y: data.map(d => d.CUMULATIVE_PNL),
        type: 'scatter',
        mode: 'lines+markers',
        name: 'Cumulative P&L',
        line: { shape: 'hv' },
        hovertemplate: '<b>Date</b>: %{x|%Y-%m-%d}<br><b>P&L</b>: $%{y:,.2f}<extra></extra>'
    }, 'Cumulative P&L Over Time', 'Date', 'P&L ($)');

    // 2. Monthly P&L Distribution
    const monthlyPnL = _.groupBy(data, d => 
        d.CLOSE_DATE.toISOString().slice(0, 7)
    );
    const monthlyData = Object.entries(monthlyPnL).map(([month, trades]) => ({
        month,
        pnl: _.sumBy(trades, 'TOTAL_GAINLOSS')
    }));
    
    createPlot({
        x: monthlyData.map(d => d.month),
        y: monthlyData.map(d => d.pnl),
        type: 'bar',
        marker: {
            color: monthlyData.map(d => d.pnl > 0 ? '#2ecc71' : '#e74c3c')
        },
        hovertemplate: '<b>Month</b>: %{x}<br><b>P&L</b>: $%{y:,.2f}<extra></extra>'
    }, 'Monthly P&L Distribution', 'Month', 'P&L ($)');

    // 3. Individual Trade P&L
    createPlot({
        x: data.map(d => d.CLOSE_DATE),
        y: data.map(d => d.TOTAL_GAINLOSS),
        type: 'bar',
        marker: {
            color: data.map(d => d.TOTAL_GAINLOSS > 0 ? '#2ecc71' : '#e74c3c')
        },
        text: data.map(d => d.SYMBOL),
        hovertemplate: '<b>Date</b>: %{x|%Y-%m-%d}<br><b>P&L</b>: $%{y:,.2f}<br><b>Symbol</b>: %{text}<extra></extra>'
    }, 'Individual Trade P&L', 'Date', 'P&L ($)');

    // 4. Trade ROI %
    createPlot({
        x: data.map(d => d.CLOSE_DATE),
        y: data.map(d => d.ROI),
        mode: 'markers',
        type: 'scatter',
        marker: {
            size: 8,
            color: data.map(d => d.ROI),
            colorscale: 'RdYlGn',
            showscale: true
        },
        hovertemplate: '<b>Date</b>: %{x|%Y-%m-%d}<br><b>ROI</b>: %{y:.1f}%<extra></extra>'
    }, 'Trade ROI %', 'Date', 'ROI (%)');

    // 5. Trade Holding Periods Histogram
    // Create dynamic buckets for holding periods
    const holdingPeriods = data.map(d => d.HOLDING_PERIOD);
    const holdingPeriodBuckets = createDynamicBuckets(holdingPeriods);
    const bucketLabels = holdingPeriodBuckets.map(bucket => bucket.label);
    const bucketCounts = bucketLabels.map(label => {
        const bucket = holdingPeriodBuckets.find(b => b.label === label);
        return data.filter(d => d.HOLDING_PERIOD >= bucket.min && d.HOLDING_PERIOD < bucket.max).length;
    });
    
    createPlot({
        x: bucketLabels,
        y: bucketCounts,
        type: 'bar',
        marker: { color: '#3498db' },
        hovertemplate: '<b>Holding Period</b>: %{x}<br><b>Count</b>: %{y}<extra></extra>'
    }, 'Trade Holding Periods Distribution', 'Holding Period', 'Number of Trades');

    // 6. P&L Distribution
    const trace = {
        x: data.map(d => d.TOTAL_GAINLOSS),
        type: 'histogram',
        nbinsx: 20,
        marker: { color: '#3498db' },
        hovertemplate: '<b>P&L Range</b>: $%{x:,.2f}<br><b>Count</b>: %{y}<extra></extra>'
    };
    createPlot(trace, 'P&L Distribution', 'P&L ($)', 'Frequency');

    // 7. Win Rate by Holding Period
    const holdingPeriodRanges = calculateHoldingPeriodRanges(data);
    createPlot({
        x: holdingPeriodRanges.map(d => d.range),
        y: holdingPeriodRanges.map(d => d.winRate),
        type: 'bar',
        marker: { color: '#9b59b6' },
        hovertemplate: '<b>Holding Period</b>: %{x}<br><b>Win Rate</b>: %{y:.1f}%<extra></extra>'
    }, 'Win Rate by Holding Period', 'Holding Period (days)', 'Win Rate (%)');

    // 8. Trade Size vs ROI
    createPlot({
        x: data.map(d => Math.abs(d.NO_WS_COST)),
        y: data.map(d => d.ROI),
        mode: 'markers',
        type: 'scatter',
        marker: {
            size: 8,
            color: data.map(d => d.TOTAL_GAINLOSS),
            colorscale: 'RdYlGn'
        },
        hovertemplate: '<b>Position Size</b>: $%{x:,.2f}<br><b>ROI</b>: %{y:.1f}%<extra></extra>'
    }, 'Trade Size vs ROI', 'Position Size ($)', 'ROI (%)');

    // Create summary statistics
    createSummaryStats(data);
}

// Helper function to calculate holding period ranges and win rates
function calculateHoldingPeriodRanges(data) {
    const sortedPeriods = [...data].sort((a, b) => a.HOLDING_PERIOD - b.HOLDING_PERIOD);
    const n = sortedPeriods.length;
    const numBins = 5;
    const binSize = Math.ceil(n / numBins);
    
    const ranges = [];
    for (let i = 0; i < numBins; i++) {
        const start = i * binSize;
        const end = Math.min((i + 1) * binSize, n);
        const binData = sortedPeriods.slice(start, end);
        const minDays = Math.floor(binData[0].HOLDING_PERIOD);
        const maxDays = Math.ceil(binData[binData.length - 1].HOLDING_PERIOD);
        const winRate = (binData.filter(d => d.TOTAL_GAINLOSS > 0).length / binData.length) * 100;
        
        ranges.push({
            range: `${minDays}-${maxDays}d`,
            winRate: winRate
        });
    }
    
    return ranges;
}

// Helper function to create dynamic buckets for the holding period histogram
function createDynamicBuckets(holdingPeriods) {
    // Get min and max holding periods
    const minPeriod = Math.min(...holdingPeriods);
    const maxPeriod = Math.max(...holdingPeriods);
    
    // Define our bucket thresholds in days
    const thresholds = [
        { max: 1, label: "≤ 24 hours" },
        { max: 7, label: "≤ 1 week" },
        { max: 14, label: "≤ 2 weeks" },
        { max: 30, label: "≤ 1 month" },
        { max: 90, label: "≤ 3 months" },
        { max: 180, label: "≤ 6 months" },
        { max: 365, label: "≤ 1 year" },
        { max: Infinity, label: "> 1 year" }
    ];
    
    // Initialize buckets
    const buckets = [];
    let prevMax = 0;
    
    // Create buckets that are relevant to the data
    for (const threshold of thresholds) {
        // Only add bucket if it's relevant to our data range
        if (prevMax < maxPeriod) {
            buckets.push({
                min: prevMax,
                max: threshold.max,
                label: threshold.label
            });
            prevMax = threshold.max;
            
            // Break if we've encompassed all data
            if (threshold.max >= maxPeriod) break;
        }
    }
    
    return buckets;
}

// Helper function to create individual plots
function createPlot(trace, title, xaxis, yaxis) {
    const div = document.createElement('div');
    div.className = 'plot-container';
    document.getElementById('plotsContainer').appendChild(div);

    const layout = {
        title: {
            text: title,
            font: { size: 16 }
        },
        xaxis: { 
            title: xaxis,
            gridcolor: 'rgba(128,128,128,0.2)',
            zerolinecolor: 'rgba(128,128,128,0.2)'
        },
        yaxis: { 
            title: yaxis,
            gridcolor: 'rgba(128,128,128,0.2)',
            zerolinecolor: 'rgba(128,128,128,0.2)'
        },
        template: 'plotly_white',
        height: 400,
        margin: { t: 50, r: 30, l: 60, b: 40 },
        hovermode: 'closest',
        showlegend: false
    };

    Plotly.newPlot(div, [trace], layout, { responsive: true });
}

// Create summary statistics
function createSummaryStats(data) {
    const monthlyPnL = _.groupBy(data, d => 
        d.CLOSE_DATE.toISOString().slice(0, 7)
    );
    const bestMonth = _.maxBy(Object.entries(monthlyPnL), ([, trades]) => 
        _.sumBy(trades, 'TOTAL_GAINLOSS')
    )[0];

    // Find the biggest single gain and loss
    const biggestGain = _.maxBy(data, 'TOTAL_GAINLOSS');
    const biggestLoss = _.minBy(data, 'TOTAL_GAINLOSS');

    const stats = {
        'Total P&L': formatCurrency(_.sumBy(data, 'TOTAL_GAINLOSS')),
        'Win Rate': `${(data.filter(d => d.TOTAL_GAINLOSS > 0).length / data.length * 100).toFixed(1)}%`,
        'Average Win': formatCurrency(_.meanBy(data.filter(d => d.TOTAL_GAINLOSS > 0), 'TOTAL_GAINLOSS')),
        'Average Loss': formatCurrency(Math.abs(_.meanBy(data.filter(d => d.TOTAL_GAINLOSS < 0), 'TOTAL_GAINLOSS'))),
        'Biggest Gain': `${formatCurrency(biggestGain.TOTAL_GAINLOSS)}`,
        'Biggest Loss': `${formatCurrency(biggestLoss.TOTAL_GAINLOSS)}`,
        'Average ROI': `${_.meanBy(data, 'ROI').toFixed(1)}%`,
        'Max ROI': `${_.maxBy(data, 'ROI').ROI.toFixed(1)}%`,
        'Average Hold Time': `${_.meanBy(data, 'HOLDING_PERIOD').toFixed(1)} days`,
        'Best Month': bestMonth
    };

    const statGrid = document.getElementById('statGrid');
    statGrid.innerHTML = '';
    
    Object.entries(stats).forEach(([label, value]) => {
        const div = document.createElement('div');
        div.className = 'stat-item';
        div.innerHTML = `
            <div class="stat-label">${label}</div>
            <div class="stat-value">${value}</div>
        `;
        statGrid.appendChild(div);
    });

    document.getElementById('summaryStats').style.display = 'block';
}

// Helper function to format currency
function formatCurrency(value) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(value);
}

// Set up file input handler
document.getElementById('csvFile').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (file) {
        document.getElementById('fileInfo').textContent = `Selected file: ${file.name}`;
        
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: function(results) {
                if (results.errors.length > 0) {
                    console.error('CSV parsing errors:', results.errors);
                    alert('Error parsing CSV file. Please check the format.');
                    return;
                }
                
                try {
                    const processedData = processTradeData(results.data);
                    if (processedData && processedData.length > 0) {
                        createPlots(processedData);
                    } else {
                        throw new Error('No valid data after processing');
                    }
                } catch (error) {
                    console.error('Error processing data:', error);
                    alert('Error processing data. Please check the CSV format and try again.');
                }
            },
            error: function(error) {
                console.error('Error parsing CSV:', error);
                alert('Error parsing CSV file. Please check the file format.');
            }
        });
    }
});