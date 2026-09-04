export const policies = {
  InvitationPolicy: () => import('#policies/invitation_policy'),
  MemberPolicy: () => import('#policies/member_policy'),
  OrganizationPolicy: () => import('#policies/organization_policy'),
}

