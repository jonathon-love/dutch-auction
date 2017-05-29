
'use strict';

const conf = {

    money: 2000,    // starting money
    maxGoods: 2000, // 'warehouse' capacity

    nTrials: 50,
    qtyMax: 600,    // for sizing the goods
    priceStepDuration: 50,
    nPriceSteps: 80,  // auction duration = steps * duration
    nDPs: 1,        // decimal places for money

    delayBefore: 2000,  // delay before auction begins
    delayAfter: 2000,   // delay after winning bid

    goodsQty: (prop) => parseInt(500 * Math.random() + 100),
    startPrice: (qty) => qty * (1 + Math.random() - 0.5),
    endPrice: (qty) => 0,
    oppBid: (qty, price) => price * Math.random(),
}

const app = require('express')();
const http = require('http').Server(app);
const serveStatic = require('serve-static');
const io = require('socket.io')(http);

const fs = require('fs');
const path = require('path');
const os = require('os');
const util = require('util');

const keypress = require('keypress');
keypress(process.stdin);
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on('keypress', handleKeyPress);

const names = [
    'Fred  ',
    'Jim   ',
    'Bob   ',
    'Willy ',
    'Mr Pig',
    'Mary  ',
    'Alice ',
    'Burt  ',
];

let props = new Array(conf.nTrials).fill(0);
props = props.map((x) => Math.random());
let sum = props.reduce((acc, cur) => acc + cur, 0);
props = props.map((x) => x / sum);

const trials = new Array();

for (let u of props) {
    let qty = conf.goodsQty(u);
    let startPrice = conf.startPrice(qty);
    let endPrice = conf.endPrice(qty);
    let oppBid = conf.oppBid(qty, startPrice);
    let winner = '';
    let price = '';

    let prop = qty / conf.qtyMax;

    trials.push({ prop, qty, startPrice, endPrice, oppBid, price, winner });
}

let fileName = new Date().toISOString().replace(/[: /]/g, '') + '.csv';
const dataPath = path.join(__dirname, 'data', fileName);
saveData(trials, dataPath);

function saveData(trials, path) {

    let data = trials.map(trial => '' + trial.prop + ',' + trial.qty + ',' + trial.startPrice + ',' + trial.endPrice + ',' + trial.oppBid + ',' + trial.price + ',' + trial.winner);
    let text = 'prop,qty,startPrice,endPrice,oppBid,price,winner\n' + data.join('\n');

    fs.writeFileSync(path, text);
}

function determineIP() {
    let ifaces = os.networkInterfaces();

    for (let name in ifaces) {
        let group = ifaces[name];
        for (let ifac of group) {
            if ( ! ifac.internal && ifac.family === 'IPv4')
                return ifac.address;
        }
    }
    throw 'IP could not be determined';
}

function dateFormat (date, fstr, utc) {
  utc = utc ? 'getUTC' : 'get';
  return fstr.replace (/%[YmdHMS]/g, function (m) {
    switch (m) {
    case '%Y': return date[utc + 'FullYear'] (); // no leading zeros required
    case '%m': m = 1 + date[utc + 'Month'] (); break;
    case '%d': m = date[utc + 'Date'] (); break;
    case '%H': m = date[utc + 'Hours'] (); break;
    case '%M': m = date[utc + 'Minutes'] (); break;
    case '%S': m = date[utc + 'Seconds'] (); break;
    default: return m.slice (1); // unknown code, remove %
    }
    // add leading zero if required
    return ('0' + m).slice (-2);
  });
}

function notifyEvent(message) {
    console.log('\n[' + dateFormat(new Date(), '%H:%M:%S') + '] ' + message)
}

function displayInfo() {
    console.log();
    console.log('Current clients:');
    for (let name in session.users) {
        let user = session.users[name];
        let line = util.format('    %s %s', user.name, user.address);
        console.log(line);
    }
    if (session.users.length === 0)
        console.log('    NONE')
    console.log();
    displayOptions();
}

function displayOptions() {
    let options = {
        s: 'start',
        q: 'quit',
    }
    let message = '';
    for (let name in options) {
        let value = options[name];
        message += '  (' + name + ') ' + value;
    }
    console.log(message);
}


function handleKeyPress(ch, key) {
    if (key.name === 'c' && key.ctrl)
        process.exit(0);
    if (ch === 'q')
        process.exit(0);
    if (ch === 's')
        run();
}

const opp = {
    bidDelay: -1,
    bidTimer: null,
    bidAmount: 0,
}

function run() {

    if (session.trialNo >= trials.length) {
        console.log('trials complete');
        process.exit(0);
    }

    session.trial = trials[session.trialNo];
    session.trial.status = 'ready';
    session.trialNo++;
    io.emit('event', session);

    setTimeout(() => {
        session.trial.status = 'running';
        io.emit('event', session);

        let auctionDuration = conf.nPriceSteps * conf.priceStepDuration;
        let oppBid = session.trial.oppBid;
        let startPrice = session.trial.startPrice;
        let endPrice = session.trial.endPrice;
        let oppBidProp = (startPrice - oppBid) / (startPrice - endPrice);
        opp.bidAmount = oppBid;
        opp.bidDelay = parseInt(auctionDuration * oppBidProp);

        let bidData = { price: opp.bidAmount, name: 'Gladys  '}
        if (opp.bidDelay >= 0)
            opp.bidTimer = setTimeout(() => bid(bidData), opp.bidDelay);

    }, conf.delayBefore);
}

const session = {
    users: { },
    trial: null,
    status: 'none',
    trialNo: 0,
};

function bid(event) {
    if (session.trial.status === 'running') {

        clearTimeout(opp.bidTimer);

        session.trial.status = 'won';
        session.trial.winner = event.name;
        session.trial.price = event.price;

        let user = session.users[event.name];
        if (user !== undefined) {
            user.money -= event.price;
            user.goods += session.trial.qty;
            if (user.goods > conf.maxGoods)
                user.goods = conf.maxGoods
        }

        io.emit('event', session)

        setTimeout(run, conf.delayAfter);

        saveData(trials, dataPath);
    }
}

app.use(serveStatic(path.join(__dirname, 'www'),
    {'index': ['default.html', 'default.htm']}));

io.on('connection', function(socket) {

    let nUsers = session.users.length;
    let user = {
        name: names.shift(),
        address: socket.handshake.address,
        money: conf.money,
        goods: 0,
    };
    session.users[user.name] = user;

    socket.on('disconnect', () => {
        delete session.users[user.name];
        notifyEvent('Client disconnected');
        displayInfo();
    });

    socket.on('bid', event => {
        bid(event);
    });

    socket.emit('init', {
        name: user.name,
        address: user.address,
        money: conf.money,
        nDPs: conf.nDPs,
        maxGoods: conf.maxGoods,
        nPriceSteps: conf.nPriceSteps,
        priceStepDuration: conf.priceStepDuration,
    });

    notifyEvent('Client connected');
    displayInfo();
});

let ip = determineIP();

http.listen(3033, ip, function(){

    let address = http.address();
    let url = util.format('    http://%s:%s/index.html', address.address, address.port);

    console.log();
    console.log('*** DUTCH AUCTION ***');
    console.log();
    console.log('Server is running and can be accessed at:')
    console.log();
    console.log(url);
    console.log();
    displayInfo();

});
