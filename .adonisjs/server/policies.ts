export const policies = {
  InvitationPolicy: () => import('#policies/invitation_policy'),
  MemberPolicy: () => import('#policies/member_policy'),
  OrganizationPolicy: () => import('#policies/organization_policy'),
  TodoListPolicy: () => import('#policies/todo_list_policy'),
  TodoPolicy: () => import('#policies/todo_policy'),
}

