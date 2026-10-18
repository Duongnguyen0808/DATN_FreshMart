INSERT INTO "permissions" ("code","name") VALUES ('dashboard.read','Xem dashboard') ON CONFLICT ("code") DO UPDATE SET "name"=EXCLUDED."name";
INSERT INTO "role_permissions" ("roleId","permissionCode") SELECT "id",'dashboard.read' FROM "roles" WHERE "code" IN ('OWNER','REGIONAL_MANAGER','BRANCH_MANAGER') ON CONFLICT DO NOTHING;
