export const policies = {
  ApiKeyPolicy: () => import('#policies/api_key_policy'),
  FilePolicy: () => import('#policies/file_policy'),
  InvitationPolicy: () => import('#policies/invitation_policy'),
  MemberPolicy: () => import('#policies/member_policy'),
  OrganizationPolicy: () => import('#policies/organization_policy'),
  SupportTicketPolicy: () => import('#policies/support_ticket_policy'),
  TodoListPolicy: () => import('#policies/todo_list_policy'),
  TodoPolicy: () => import('#policies/todo_policy'),
}

