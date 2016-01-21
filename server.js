var express = require('express');
var config = require('./config');
var S = require('string');
var fs = require("fs");
var tmp = require('tmp');
var TelegramBot = require('node-telegram-bot-api');
var request = require('request');
var audioConverter = require("audio-converter");
var async = require('async');
var forEachAsync = require('forEachAsync').forEachAsync;
var moment = require('moment');

var server = express();

var bot = new TelegramBot(config.telegram_token, {polling: true}); // Setup polling way
var jobstack = []; // just array to store telegram bot requests


// ASKOZIA
var ami = new require('asterisk-manager')(config.agi_port, config.agi_host, config.agi_login, config.agi_pass, true);
ami.keepConnected();

ami.on('disconnect', function(evt) {
    console.log('ATS askozia disconnected ('+moment().format()+'):');
    console.log(evt);
});

ami.on('connect', function(evt) {
    console.log('==========================================================');
    console.log('ATS askozia connected! '+'('+moment().format()+')');
});

ami.on('userevent', function(event) {
    // console.log(event); // for debug only - show all userevent

    if (event.userevent == 'GetRecordsFromNode') {
        var from_id = event.from_id;
        var answer_text = event.lines;
        answer_text = answer_text.replace(/#/g, '\n');
        console.log('Data from askozia ATS: \n'+answer_text); // for debug

        var records = [];
        var lines = S(answer_text).lines();

        for (var i = 0; i < lines.length; i++) {
            var propetries = S(lines[i]).parseCSV('|', null);
            var record = {
                AcctId:propetries[0],
                uniqueid:propetries[1],
                start:propetries[2],
                answer:propetries[3],
                end:propetries[4],
                duration:propetries[5],
                billsec:propetries[6],
                recordingfile:propetries[7],
                localDir: '',
                localWav: '',
                localOgg: '',
                localMp3: '',
                fileSize: ''
            };
            records.push(record);

        }
        // Download and send files to telegram
        GetFilesAndSendAsync(records, from_id);

    }

    if (event.userevent == 'NoRecordsFoundNode') {
        // send Telegram message about empty results
        console.log('Nothing found by number: ' + event.tel);
        console.log('==========================================================');

        var messageText = "По номеру: " + event.tel + " не найдено ни одной записи!";
        bot.sendMessage(event.from_id, messageText);
    }

    // console.log("Another user event:");
    // console.log(event);

}); //ami.on('userevent')

ami.connect(function(){
});


var SendFileAsync = function(record, from_id, cb) {
    // SEND Info message
    console.log("Send record: "+record.recordingfile+" for: "+from_id+' ('+moment().format()+')');
    var messageText = "Звонок (период: " + record.start + " - " + record.end + " длит.: " + record.duration + " сек.";
    bot.sendMessage(from_id, messageText);

    if (record.fileSize) {
        // SEND File
        bot.sendAudio(from_id, record.localMp3, {title: record.start})
            .then(function(resp) {
                console.log("Record was successfully sent!");
                console.log("Delete temporary files...");
                fs.unlinkSync('./' + record.localWav);
                fs.unlinkSync('./' + record.localOgg);
                fs.unlinkSync('./' + record.localMp3);
                fs.rmdirSync('./' + record.localDir);
                cb(); // callback to forEachAsync
            });
    } else {
        console.log("Record " + record.start + " was skipped (empty record file)!");
        messageText = "Пустой файл записи звонка: " + record.start;
        bot.sendMessage(from_id, messageText);
        cb(); // callback to forEachAsync
    }
}; // SendFileAsync

var SendFilesAsync = function(records, from_id) {
    console.log("Start sending records...");
    forEachAsync(records, function(next, record, i, arr) {
        SendFileAsync(record, from_id, next);
    }).then(function() {
        console.log('All operations were made! ('+moment().format()+')');
        console.log('==========================================================');
    });
}; // SendFilesAsync

var GetFilesAndSendAsync = function(records, from_id) {

    var adress = "/cfe/wallboard/1c/download.php?type=Records&view=";
    var host   = "http://"+config.agi_host + adress;
    var login  = 'statistic';
    var pass   = config.statpass;

    async.each(records,
        function(record, nextrecord) {

            var tmpDir = tmp.dirSync({
                dir: "./records"
            });
            var tempFile = tmp.fileSync({
                //dir: "./records/"+tmpDir.name,
                dir: tmpDir.name,
                prefix: 'rec-',
                postfix: '.wav'
            });

            var tempNameWav = tempFile.name;
            var tempNameOgg = tempNameWav.replace(/\.wav$/, '.ogg');
            var tempNameMp3 = tempNameWav.replace(/\.wav$/, '.mp3');

            console.log("Try get: " + record.recordingfile);
            var url = host + adress + record.recordingfile;
            request
                .get(url, {
                    'auth': {
                        'user': login,
                        'pass': pass,
                        'sendImmediately': false
                    }
                })
                .on('error', function(err) {
                    console.log("error get file from askozia: " + err);
                })
                .on('response', function(response) {
                    fileSize = response.headers['content-length'];
                    record.fileSize = fileSize;
                    if (fileSize) {
                        console.log("File saved as: " + tempNameWav);
                        record.localDir = tmpDir.name;
                        record.localWav = tempNameWav;
                        record.localOgg = tempNameOgg;
                        record.localMp3 = tempNameMp3;
                    }
                    else {
                        console.log("File is empty (deleting): " + tempNameWav);
                        fs.unlinkSync('./' + tempNameWav);
                        fs.rmdirSync('./' + tmpDir.name); // and don't forget delete empty temp dir
                    }

                    nextrecord();

                })
                .pipe(fs.createWriteStream(tempNameWav)); // save file from askozia to disk

        },
        function(err) {
            if (err) {
                // return next(err);
                console.log('Error in each.async (getting files from askozia): ' + err);
            } else {

                console.log(records);
                // NOW CONVERT FILES
                console.log("Start converting ...");
                audioConverter("./records", "./records", {
                    //progressBar: true,
                    //verbose: true,
                    //mp3Only: true,
                    //mp3Quality:128,
                    //oggOnly: true,
                    chunkSize: 1
                }).then(function() {
                    console.log("Audio files converted!");
                    // SEND Files to Telegram
                    SendFilesAsync(records, from_id);

                }, function(converr) {
                    console.log("Error converting: ");
                    console.log(converr);
                });
            }
        });
};


// BOT SERVER
bot.onText(/\/echo (.+)/, function (msg, match) {
  var fromId = msg.from.id;
  var resp = match[1];
  bot.sendMessage(fromId, resp);
});

// Get user ID in Telegram
bot.onText(/\/id$/, function (msg, match) {
    chek_access(msg);
});

bot.onText(/\/start$/, function (msg, match) {
    chek_access(msg);
});


bot.onText(/^7[0-9]{10,10}$/, function (msg, match) {
    var fromId = msg.from.id;
    var telephone = msg.text;

    // проверка авторизации
    if(!in_array(fromId, config.ids)) {

        console.log('==========================================================');
        console.log('Запрос записей по номеру: '+telephone+' ('+moment().format()+')');
        console.log('От неавторизованного ID: '+fromId+' ('+msg.from.first_name+' '+msg.from.last_name+')');
        console.log('==========================================================');

        bot.sendMessage(fromId, "Ваш ID: "+fromId+ " не авторизован!\n"+
                                "Сообщите его администратору для получения доступа к записям.\n\n");
        return;
    }

    // обновим задания в стеке
    jobstack[fromId] = {
        message_id: msg.message_id,
        telephone: telephone
    };

    var opts = {
      reply_to_message_id: msg.message_id,
      reply_markup: JSON.stringify({
        keyboard: [
          ['1','2','3'],['4','5','6'],['7','8','9']],
        // resize_keyboard: true,
        one_time_keyboard: true
      })
    };
    bot.sendMessage(fromId, 'Сколько прислать записей?', opts);

}); // bot.onText(telephone)

bot.onText(/^[1-9]{1,1}$/, function (msg, match) {
    var fromId = msg.from.id;
    var quantity = msg.text;

    if (!jobstack[fromId]) {
        console.log("Нет заданий для абонента: "+fromId);
        return;
    }

    var telephone = jobstack[fromId].telephone;

    var logMessage = 'Начало обработки запроса '+quantity+' записей по номеру: '+telephone+' ('+moment().format()+')\n'+
                     'запрос поступил от ID: '+fromId+' ('+msg.from.first_name+' '+msg.from.last_name+')';
    bot.sendMessage(config.admin_id, logMessage); // log message fo admin telegram
    console.log(logMessage);

    jobstack[fromId] = undefined; // очищаем стек заданий

    bot.sendMessage(fromId, 'Отправлен запрос '+quantity+' записей по номеру: '+telephone);

    ami.action({
      'action': 'originate',
      'channel': 'Local/10000123@internal',
      'context': 'default',
      'exten': 10000123,
      'priority': 1,
      'variable': {
              'v1': telephone,
              'v2': '',
              'v3': quantity, // quantity of records
              'v4': fromId // from_id (telegram)
          }
      }, function(err_ami, res_ami) {
          if(err_ami) {
              // res.status(404).send(err_ami);
              bot.sendMessage(fromId, 'Ошибка отправки запроса: '+err_ami);
          }
          else {
              // res.status(201).send(res_ami);
              // bot.sendMessage(fromId, 'Запрос отправлен, ожидаем получение записей...');
          }
      });

}); // bot.onText(quantity of records)

// Any kind of message
bot.on('message', function (msg) {
  // console.log(msg); // for debug
});

function in_array(value, array)
{
    for(var i = 0; i < array.length; i++)
    {
        if(array[i] == value) return true;
    }
    return false;
} // in_array(value, array)

function chek_access(msg)
{
    var fromId = msg.from.id;
    var textMessage = "Ваш ID: "+fromId+"\n";
    // проверка авторизации
    if(!in_array(fromId, config.ids)) {
        textMessage = textMessage + "Сообщите его администратору для получения доступа к записям.\n\n";
    }
    textMessage = textMessage + "Чтобы получить записи - отправьте номер телефона строго в формате: 7ХХХХХХХХХХ";
    bot.sendMessage(fromId, textMessage);
} // chek_access(msg)

function job_exist(fromId)
{
    for(var i = 0; i < jobstack.length; i++)
    {
        if(jobstack[i].fromID == fromId)
            return true;
    }
    return false;
} // job_exist(fromId)
