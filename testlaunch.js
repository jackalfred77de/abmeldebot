const {Telegraf} = require('telegraf');
const bot = new Telegraf('8734340861:AAHFai4sqkCcOyh7JGzLg5a2VnJmLnZ8ji0');

async function test() {
  console.log('1. deleteWebhook...');
  try { await bot.telegram.deleteWebhook({drop_pending_updates:true}); console.log('   ok'); } catch(e) { console.log('   err:', e.message); }

  console.log('2. getUpdates timeout=0...');
  try { const r = await bot.telegram.callApi('getUpdates', {timeout:0,offset:0,limit:1}); console.log('   ok, updates:', r.length); } catch(e) { console.log('   err:', e.message); }

  console.log('3. Aguardando 12s...');
  await new Promise(r => setTimeout(r, 12000));

  console.log('4. bot.launch...');
  try {
    await bot.launch({dropPendingUpdates:true, allowedUpdates:['message','callback_query']});
    console.log('   >>> LAUNCHED OK! <<<');
    setTimeout(()=>{bot.stop();process.exit(0);},3000);
  } catch(e) {
    console.log('   FAIL:', e.code, e.message);
    process.exit(1);
  }
}
test();
