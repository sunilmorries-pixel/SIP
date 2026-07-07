select 
u.project_key
,u.issue_key
,u.ticket_created
,u.ticket_updated
,u.summary
,u.issuetype_id
,u.issuetype_name
,u.status_name
,u.customfield_10127 customername
,u.customfield_10128 customerid
,cl.author
,cl.field_changed
,cl.from_value
,cl.to_value
,cl.last_field_updated
,cl.load_timestamp
	
from 
skilful-asset-297610.mukund_DE_playground.jira_issues u 
LEFT JOIN 
skilful-asset-297610.mukund_DE_playground.jira_changelog cl
ON u.project_key = cl.project_key AND u.issue_key = cl.issue_key