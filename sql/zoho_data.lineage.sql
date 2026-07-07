WITH organization as (SELECT om.member_id hub_id,o.organization_name FROM `tricogde-dwh.fivetran_olympus_ecg_ecg.organizations` o
INNER JOIN
tricogde-dwh.fivetran_olympus_ecg_ecg.organization_members om
ON
o.organization_id=om.organization_id)
SELECT
ticketNumber
,DepartmentName
,TicketRaisedBy
,TicketOwnerTeam
,assignee
,z.country
,CustomerEmail
,subject
,TicketLink
,z.status
,IssueCategory
,IssueSummary
,TicketClosedBy
,CreatedAt
,ClosedAt
,ModifiedAt
,ResolutionProvided
,IsCreatedYesterday
,IsClosedYesterday
,TicketActiveDays
-- ,cf
,DueDate
,z.HubName
,z.HubID
,z.Centername
,z.CenterID
,Primary_Owner
,Ticket_Transfer_Date_To_Other_Department
,TAG
,z.Segment
,Ticket_Group
,Audit_Classification
,Ticket_Raised_By
,z.Sale_Type
,Country_OR_Service_Classification
,Machine_OR_Devie_Model_Issue
,Ticket_Type_OR_Issue_Type
,Resolution_given
,FOC_Approved_By
,Payment_Received_Via
,Total_Amount_Received
,Closed_Tags
,Sub_Status_for_Customer_Success_Team
,FSE_Name_Only_SAD
,Field_Visit_status_Only_SAD
,ECG_Machine
,Closed_By
,Channel
,priority
,JSON_EXTRACT_SCALAR(dc.customfields, '$.Master Segment') AS MasterSegment
,dc.type as customer_type
,JSON_EXTRACT_SCALAR(c1.customfields, '$.Master Segment') AS hub_master_segment
,dc.Suspended
,dc.Status as customer_status
,c1.is_prepaid
,organization_name

,m.am account_manager
,m.sales_manager
,m.offering
,m.group
,dc.pin as pincode

,m.segment as manager_sheet_segment

,m.vcardia
,m.mac
,m.TR
,m.total_units
,m.inactive_units
,m.active_units

FROM

`skilful-asset-297610.primary_dataset.mod_zoho_tickets` z
LEFT JOIN
`tricogde-dwh.TricogDataStore.DIM_Centers` dc
ON
z.CenterID=dc.CenterID
INNER JOIN
`tricogde-dwh.TricogDataStore.DIM_Centers` c1
ON dc.HubID = c1.CenterID
LEFT JOIN
organization o
ON SAFE_CAST(o.hub_id AS INT) = dc.HubID

LEFT JOIN
tricogde-dwh.dwh_gsheets.le_managers m
ON
dc.hubid = m.hub_id

ORDER BY
  SAFE_CAST(ticketNumber AS int64) DESC
    