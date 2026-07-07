WITH CenterUsageStas AS
(
  SELECT c.CenterID
  ,SUM(Number_of_ECGs) as TotalECGs
  ,AVG(Number_Of_ECGs) as DailyAVGs
  ,MAX(AcquiredDate) as LastECGDate
  FROM
  `tricogde-dwh.TricogDataStore.agg_RESTING_STATS` ars
  INNER JOIN
  `TricogDataStore.DIM_Centers` c
  ON c.CenterID = ars.CenterID

    GROUP BY 1
)

,HuBUsageStas AS
(
  SELECT c.HubID
  ,SUM(Number_of_ECGs) as TotalECGs
  ,AVG(Number_Of_ECGs) as DailyAVGs
  ,MAX(AcquiredDate) as LastECGDate
  FROM
  `tricogde-dwh.TricogDataStore.agg_RESTING_STATS` ars
  INNER JOIN
  `TricogDataStore.DIM_Centers` c
  ON c.CenterID = ars.CenterID
    GROUP BY 1

)
, lastDeviceId AS(
SELECT
ars.CenterId
,ars.AcquiredDate 
,ars.DeviceID
,ars.MacSerialID
,MachineType
,ROW_NUMBER() OVER (PARTITION BY CenterID ORDER BY AcquiredDate DESC ) AS lastestdevice
FROM
`TricogDataStore.agg_RESTING_STATS` ars
)
,billplandates AS (
    SELECT
  centerid
  ,MIN(startdate) AS EarliestBillPlanDate
  ,MAX(startdate) AS LatestBillPlanDate
  FROM
  `TricogDataStore.FACT_BillPlan` bp
  GROUP BY 1
)
,  critical_call_config AS 
(
  SELECT
centerid as cid ,json_extract_scalar(preferences, "$.criticalCall") AS criticalCall_config
FROM
`tricogde-dwh.fivetran_olympus_ecg_ecg.centerpreferences`
WHERE
json_extract_scalar(preferences, "$.criticalCall") IS NOT NULL
)
SELECT
c.centerid
,c.Centername
,(CASE
WHEN c.type='NETWORK_SPOKE' THEN 'Spoke'
WHEN c.type='NETWORK_HUB' THEN 'Hub'
WHEN c.type='CENTER' THEN 'Center'
END )as Type
,c.Status
,c.HubID
,c.HubName
,c.deploymentdate
,ldid.AcquiredDate
,DATE_DIFF(CURRENT_DATE(), DATE(c.deploymentdate), MONTH) AS Age_In_Months
,c.Suspended
,c.city
,c.Spoke_Center_Segment
,c.address1
,c.address2
,c.pin AS PinCode
,c.state
,dz.Zone
,c.Country AS Spoke_Country
,c.Country2 AS Hub_Country
,c.channelpartner
,c.Assignedmanager
,c.Sales_Executive
,C.Account_Manager
,c.IS_PREPAID
,c.Sale_Type
,c.Product_Type
,ldid.DeviceID
,ldid.MacSerialID
,MachineType
,c.Device_Rental
,c.MaximumECGs
,c.ExceedingCost
,c.Current_MRR
,c1.current_mrr as hub_mrr
,c.Interpretation_mrr
,c.Current_units
,c.Billable
,JSON_EXTRACT_SCALAR(c.customfields, '$.Is Bulk Download Enable') AS Is_Bulk_Download_Enable
,JSON_EXTRACT_SCALAR(c.customfields, '$.Customer Status') AS Customer_Status
,JSON_EXTRACT_SCALAR(c.customfields, '$.Master Segment') AS Master_segment

,JSON_EXTRACT_SCALAR(JSON_EXTRACT_SCALAR(c.customfields,"$.Webhook")) AS Webhook
,JSON_EXTRACT_SCALAR(c.customfields,"$.Webhook Meta") AS Webhook_Meta
,JSON_EXTRACT_SCALAR(c.customfields,"$.Patient info hook meta") AS Patient_info_hook_meta
,JSON_EXTRACT_SCALAR (c.customfields,"$.Patient info hook") AS Patient_info_hook
,JSON_EXTRACT_SCALAR(c.customfields,"$.Transformer Webhook") AS Transformer_Webhook
,cu.DailyAVGs
,cu.LastECGDate
,cu.TotalECGs
,c.QB_ID
,c.QB_Domain
,ROUND(cu2.DailyAVGs,2 ) AS hub_DailyAVGs
,cu2.LastECGDate AS hub_LastECGDate
,cu2.TotalECGs AS hub_TotalECGs


,CASE WHEN cc1.name="ENABLE_CASES_TYPE" THEN cc1.value END AS Case_Type 
,CASE WHEN cc.name="CASE_SUBMISSION" THEN JSON_EXTRACT_SCALAR(cc.value,"$.RESTING") END AS Case_Submission
-- new addtion 14/05/24
,COALESCE(JSON_EXTRACT_SCALAR(cc.value,"$.RESTING") , CASE WHEN c.type = "NETWORK_HUB" AND cc.centerid IS NULL THEN "AUTO_SUBMISSION" END) AS CASE_SUBMISSION_withDefault
,CASE WHEN cc2.name="PRODUCT_OFFERING" THEN JSON_EXTRACT_SCALAR(cc2.value,"$.value") END AS Product_Offering
,CASE WHEN cc3.name="REPORT_TEMPLATE"  THEN JSON_EXTRACT_SCALAR(cc3.value,"$.value") END AS Report_Template
,c.Is_Cardionet_User
,c.GenerateAutoInvoice

,COALESCE(JSON_EXTRACT_SCALAR(c.customfields, '$.Master Segment'),spk.master_segment) AS Spk_master_segment
,COALESCE(JSON_EXTRACT_SCALAR(c.customfields, '$.Service Type'),spk.service_type) AS Spk_service_type
,COALESCE(JSON_EXTRACT_SCALAR(c.customfields, '$.Hardware Type'),spk.hardware_type)AS Spk_hardware_type

,COALESCE(JSON_EXTRACT_SCALAR(c1.customfields, '$.Master Segment'),hub.master_segment) AS hub_master_segment
,COALESCE(JSON_EXTRACT_SCALAR(c1.customfields, '$.Service Type'),hub.service_type) AS hub_service_type
,COALESCE(JSON_EXTRACT_SCALAR(c1.customfields, '$.Hardware Type'),hub.hardware_type)AS hub_hardware_type
,COALESCE(JSON_EXTRACT_SCALAR(c1.customfields, '$.Hardware Sale Type'),hub.hardware_sale_type )AS hub_hardware_sale_type
,JSON_EXTRACT_SCALAR(c.customfields,"$.ECHO configuration") as Echo_Configuration
,c.timezone

,JSON_EXTRACT_SCALAR(cp.preferences,"$.doNotAutoSuspend") AS doNotAutoSuspend
,COALESCE(JSON_EXTRACT_SCALAR(cp.preferences,"$.doNotAutoSuspend"),"0") AS doNotAutoSuspend_Default
,JSON_EXTRACT_SCALAR(cp.preferences,"$.showRepeatEcg") AS showRepeatEcg

,EarliestBillPlanDate
,LatestBillPlanDate
,c.Active_Billplan
,c.HasBillPlan
,c.deactivationdate
,JSON_EXTRACT_SCALAR(c.customfields,"$.disable_rediagnosis") AS disable_rediagnosis

,c.mqID
,c.hub_mqID
,c.selectiveSubmission
,c.stemiAlarmForVcardia
,c.managedByMQ
,c.hub_selectiveSubmission
,c.hub_stemiAlarmForVcardia
,c.hub_managedByMQ
-- ,PRODUCT_OFFERING
,c.hub_PRODUCT_OFFERING


,ccc1.criticalCall_config as center_critical_call_config
,ccc2.criticalCall_config as Hub_call_config

,IF((c.Spoke_Center_Segment = 'F2P_CENTER'),1,0) AS F2P_Customer


,vws.organization_name

FROM
`TricogDataStore.DIM_Centers` c
LEFT JOIN
`TricogDataStore.DIM_ZONES` dz
ON lower(trim(c.state)) = lower(trim(dz.state))
LEFT JOIN 
`TricogDataStore.DIM_Centers` c1
ON
c.HubID =  c1.CenterID
LEFT JOIN
CenterUsageStas cu 
ON
c.CenterID=cu.centerid
LEFT JOIN
HuBUsageStas cu2 
ON
c.CenterID=cu2.hubid
LEFT JOIN 
lastDeviceId ldid
ON c.CenterID = ldid.CenterId
AND ldid.lastestdevice = 1 
LEFT JOIN
`fivetran_olympus_ecg_ecg.centers_config` cc
ON c.centerid = cc.centerid
AND cc.name="CASE_SUBMISSION" 
LEFT JOIN
`fivetran_olympus_ecg_ecg.centers_config` cc1
ON c.centerid = cc1.centerid
AND cc1.name="ENABLE_CASES_TYPE"
LEFT JOIN
`fivetran_olympus_ecg_ecg.centers_config` cc2
ON c.centerid = cc2.centerid
AND cc2.name="PRODUCT_OFFERING"
LEFT JOIN
`fivetran_olympus_ecg_ecg.centers_config` cc3
ON c.centerid = cc3.centerid
AND cc3.name="REPORT_TEMPLATE"

--
LEFT JOIN
`tricogde-dwh.dwh_gsheets.hub_master_segment` hub
ON 
c.HubID=hub.hubid
LEFT JOIN
`tricogde-dwh.dwh_gsheets.spoke_master_segment` spk
ON 
c.CenterID=spk.centerid
LEFT JOIN
`fivetran_olympus_ecg_ecg.centerpreferences` cp
ON c.CenterID = cp.centerid

LEFT JOIN
billplandates bp
ON c.CenterID = bp.centerid


LEFT JOIN
critical_call_config ccc1
ON
c.Centerid=ccc1.cid

LEFT JOIN
critical_call_config ccc2
ON
c.HubID=ccc2.cid

LEFT JOIN
`tricogde-dwh.TricogDataStore.vw_stemimapping` vws
ON c.hubId = SAFE_CAST(vws.hub_id AS INT)
/*
WHERE
(c.Spoke_Center_Segment != 'F2P_CENTER'
or
c.Spoke_Center_Segment is null )
*/