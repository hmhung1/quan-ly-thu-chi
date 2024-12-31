require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const http = require('http');

const dashboard = http.createServer((_req, res) => {
    res.writeHead(200, "OKay", { "Content-Type": "text/html" });
    res.write("Hello from Delta :>");
    res.end();
  });
  const port = process.env.PORT || 6788;
  dashboard.listen(port, () => {
    loader(`Server is running on http://localhost:${port}`);
  });
  

mongoose.connect(process.env.MONGODB_URI);

const transactionSchema = new mongoose.Schema({
    userId: { type: Number, required: true },
    amount: Number,
    type: String,
    note: String,
    date: { type: Date, default: Date.now },
});

const Transaction = mongoose.model('Transaction', transactionSchema);

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
bot.setMyCommands([
    { command: 'start', description: 'Hiển thị hướng dẫn sử dụng' },
    { command: 'wallet', description: 'Xem số dư tài khoản' },
    { command: 'history', description: 'Xem lịch sử giao dịch' },
    { command: 'delete', description: 'Xóa giao dịch' },
])

async function getWalletBalance(userId) {
    const income = await Transaction.aggregate([
        { $match: { type: 'income', userId } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const expense = await Transaction.aggregate([
        { $match: { type: 'expense', userId } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);

    const totalIncome = income[0]?.total || 0;
    const totalExpense = expense[0]?.total || 0;

    return totalIncome - totalExpense;
}

async function getHistory(userId, limit = 10) {
    return await Transaction.find({ userId }).sort({ date: -1 }).limit(limit);
}

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(
        msg.chat.id,
        `
Chào mừng bạn đến với bot quản lý thu chi!

Hướng dẫn sử dụng:
- **Thêm thu nhập**: Nhập "\`+5tr lương\`" để thêm thu nhập 5 triệu từ lương.
- **Thêm chi tiêu**: Nhập "\`20k ăn sáng\`" để thêm chi tiêu 20k cho bữa sáng.

Các lệnh hỗ trợ:
- /wallet - Xem số dư tài khoản hiện tại.
- /history - Xem lịch sử các giao dịch.
- /delete <số thứ tự> - Xóa giao dịch theo số thứ tự trong lịch sử giao dịch.
    `, { parse_mode: 'Markdown' }
    );
});

bot.onText(/\/wallet/, async (msg) => {
    const userId = msg.from.id;
    const balance = await getWalletBalance(userId);
    bot.sendMessage(msg.chat.id, `Số dư hiện tại: ${balance.toLocaleString()}đ`);
});

bot.onText(/\/history/, async (msg) => {
    const userId = msg.from.id;
    const transactions = await getHistory(userId);
    if (transactions.length === 0) {
        bot.sendMessage(msg.chat.id, `Chưa có giao dịch nào.`);
    } else {
        const history = transactions
            .map((t, index) => {
                const dateVietnam = new Date(t.date).toLocaleString('vi-VN', {
                    timeZone: 'Asia/Ho_Chi_Minh',
                });
                const typeLabel = t.type === 'income' ? 'Thu' : 'Chi';
                return `${index + 1}. ${typeLabel} ${t.amount.toLocaleString()}đ từ ${t.note} (${dateVietnam})`;
            })
            .join('\n');
        bot.sendMessage(msg.chat.id, `Lịch sử giao dịch:\n${history}`);
    }
});

bot.onText(/\/delete (\d+)/, async (msg, match) => {
    const userId = msg.from.id;
    const index = parseInt(match[1], 10) - 1;

    const transactions = await getHistory(userId);

    if (index < 0 || index >= transactions.length) {
        bot.sendMessage(msg.chat.id, `Số thứ tự không hợp lệ. Vui lòng kiểm tra lại lịch sử giao dịch.`);
        return;
    }

    const transactionToDelete = transactions[index];

    try {
        await Transaction.deleteOne({ _id: transactionToDelete._id });
        bot.sendMessage(msg.chat.id, `Đã xóa giao dịch: ${transactionToDelete.amount.toLocaleString()}đ (${transactionToDelete.type}) - ${transactionToDelete.note}`);
    } catch (err) {
        bot.sendMessage(msg.chat.id, 'Lỗi khi xóa giao dịch. Vui lòng thử lại.');
    }
});

bot.on('message', async (msg) => {
    const text = msg.text.trim();
    const userId = msg.from.id;
    const match = text.match(/([+-]?\d+\w?)\s+(.*)/);

    if (match) {
        let [_, rawAmount, note] = match;
        let multiplier = 1;

        if (rawAmount.includes('k')) {
            multiplier = 1000;
            rawAmount = rawAmount.replace('k', '');
        } else if (rawAmount.includes('tr')) {
            multiplier = 1000000;
            rawAmount = rawAmount.replace('tr', '');
        }

        try {
            const amount = parseInt(rawAmount) * multiplier;
            const type = rawAmount.startsWith('+') ? 'income' : 'expense';

            await Transaction.create({
                userId,
                amount: Math.abs(amount),
                type,
                note,
            });

            bot.sendMessage(
                msg.chat.id,
                `Đã ghi lại giao dịch: ${Math.abs(amount).toLocaleString()}đ ` +
                `(${type === 'income' ? 'Thu nhập' : 'Chi tiêu'}) - ${note}`
            );
        } catch (err) {
            bot.sendMessage(msg.chat.id, 'Lỗi khi lưu giao dịch. Vui lòng thử lại.');
        }
    }
});

console.log('Bot đang chạy...');
