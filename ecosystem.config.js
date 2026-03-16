module.exports = {
  apps: [{
    name: 'abmeldebot',
    script: 'bot.js',
    cwd: '/Users/FredHome/Library/CloudStorage/OneDrive-FredericoReichel/BüroEasy - Documents/Abmeldung/abmeldebot',
    restart_delay: 45000,    // 45s > 10s polling timeout → sessão definitivamente expirada
    max_restarts: 50,
    min_uptime: 5000,
    env: {
      TELEGRAM_BOT_TOKEN: '8734340861:AAHFai4sqkCcOyh7JGzLg5a2VnJmLnZ8ji0',
      ADMIN_CHAT_ID: '661435601',
      PYTHON_PATH: '/Library/Frameworks/Python.framework/Versions/3.11/bin/python3',
      NODE_ENV: 'production',
      SMTP_HOST: 'smtp.office365.com',
      SMTP_PORT: '587',
      SMTP_USER: 'buero@rafer.de',
      SMTP_PASS: '',
      SMTP_FROM: 'buero@rafer.de',
    }
  }]
};
