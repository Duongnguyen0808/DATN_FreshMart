INSERT INTO "role_permissions" ("roleId","permissionCode")
SELECT "id",'stocktakes.create' FROM "roles" WHERE "code"='OWNER'
ON CONFLICT DO NOTHING;
