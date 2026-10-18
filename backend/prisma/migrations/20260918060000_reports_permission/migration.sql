INSERT INTO "permissions" ("code","name") VALUES ('reports.read','Xem báo cáo vận hành') ON CONFLICT ("code") DO UPDATE SET "name"=EXCLUDED."name";
INSERT INTO "role_permissions" ("roleId","permissionCode") SELECT "id",'reports.read' FROM "roles" WHERE "code" IN ('OWNER','REGIONAL_MANAGER','BRANCH_MANAGER','ACCOUNTANT') ON CONFLICT DO NOTHING;
