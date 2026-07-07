SELECT
c.CenterID
,c.Centername
,c.HubID
,c.HubName
,d.DeviceID
,d.IMSI
,d.CSQ
,DATETIME_ADD(SAFE_CAST(d.LastTimeStamp AS TIMESTAMP),INTERVAL 330 MINUTE) AS LastTimeStamp
,d.ServiceProvider
,d.PreviousHBLatency
,d.UnsyncedData
,d.lastHeartbeatData
,JSON_EXTRACT_SCALAR(d.lastHeartbeatData,"$.BatteryLevel") AS BatteryLevel
,JSON_EXTRACT_SCALAR(d.lastHeartbeatData,"$.LastShutdown") AS LastShutdown
,JSON_EXTRACT_SCALAR(d.lastHeartbeatData,"$.BatteryDischarging") AS BatteryDischarging
,JSON_EXTRACT_SCALAR(d.lastHeartbeatData,"$.SpaceAvailable") AS SpaceAvailable
,JSON_EXTRACT_SCALAR(d.lastHeartbeatData,"$.EcgCounter") AS EcgCounter
,JSON_EXTRACT_SCALAR(d.lastHeartbeatData,"$.Retries") AS Retries
,JSON_EXTRACT_SCALAR(d.lastHeartbeatData,"$.Latency") AS Latency

,d.hardwareversion AS hardwareversion_clouddevices
,ed.hardwareversion AS hardwareversion_devicestable
,FirmwareName
FROM
`tricogde-dwh.TricogDataStore.Cloud_Devices` d
LEFT JOIN
`tricogde-dwh.fivetran_olympus_ecg_ecg.devices` ed
ON
d.DeviceID=ed.deviceid
INNER JOIN  
`tricogde-dwh.TricogDataStore.DIM_Centers` c
ON
SAFE_CAST(ed.centerid AS INT)=c.CenterID
;
