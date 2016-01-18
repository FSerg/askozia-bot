<?php
/*-----------------------------------------------------
// Askozia records Node Downloader // 10000123
// Загрузка записей разговоров для NodeJS приложения
-------------------------------------------------------
Asterisk 1.8.4.4
PHP 4.4.9
sqlite3 -version 3.7.0
AGI phpagi.php,v 2.14 2005/05/25 20:30:46
-------------------------------------------------------*/
require("phpagi.php");
require("guiconfig.inc");

function GetVarChannnel($agi, $_varName){
  $v = $agi->get_variable($_varName);
  if(!$v['result'] == 0){
    return $v['data'];
  }
  else{
    return "";
  }
}
$agi = new AGI();

$EXTEN = GetVarChannnel($agi, "EXTEN");
if($EXTEN == "h"){
  // это особенность работы с Askozia, для избежания зацикливания
  // http://igorg.ru/2011/10/22/askozia-opyt-ispolzovaniya
}else{

  $src         = GetVarChannnel($agi,'v1');
  $faxrecfile  = GetVarChannnel($agi,'v2');
  $quantity  = GetVarChannnel($agi,'v3');
  $from_id = GetVarChannnel($agi,'v4');

  if(strlen($faxrecfile) <= 4 && strlen($src) >= 4){
    // 1.Формируем запрос
    $disk = storage_service_is_active("astlogs");
    // проверим, есть ли временная база
    // если есть, то запросы к ней
    $cdr_db = $disk['mountpoint']."/askoziapbx/astlogs/asterisk/master.db";
    $zapros =  "SELECT
            AcctId,
            uniqueid,
            start,
            answer,
            end,
            duration,
            billsec,
            recordingfile
        FROM cdr
        WHERE recordingfile!=''
              AND src='$src'
              ORDER BY start DESC
        LIMIT $quantity";
    // 2. Выполняем запрос
    // $faxrecfile = rtrim(exec("sqlite3 $cdr_db \"$zapros\""));

    $output   = array();
    $agi->verbose("Start!");
    $answer = exec("sqlite3 $cdr_db \"$zapros\"", $output);
  }

  $counter=1;
  $lines="";
  foreach($output as $_data){
      if ($counter > 1) {
          $lines = $lines."#";
      }

      $_data = str_replace(" ", '\ ', $_data);
      $_data = rtrim($_data);
      $lines = $lines.$_data."";
      $counter=$counter+1;
      $agi->verbose("Data".$counter.": ".$_data); // пишем в лог полученные данные, пока для отладки
  }

  if(strlen($lines) > 4){
      $agi->exec("UserEvent",
      "GetRecordsFromNode,from_id:$from_id,Lines:$lines");
      $agi->verbose("End!");
  }
}

// отклюаем запись CDR для приложения
$agi->exec("NoCDR", "");
// ответить должны лишь после выполнения всех действий
// если не ответим, то оргининация вернет ошибку
$agi->answer();
?>
​
