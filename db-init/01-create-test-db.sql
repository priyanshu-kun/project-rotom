-- Runs once on first Postgres container init. Creates the isolated database the
-- test suite uses, so tests never touch the dev `rotom` database (which they
-- would otherwise wipe in beforeAll).
CREATE DATABASE rotom_test;
GRANT ALL PRIVILEGES ON DATABASE rotom_test TO rotom;
