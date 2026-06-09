from django.db import migrations


class Migration(migrations.Migration):
    initial = True
    dependencies = [
        ("users", "0001_initial"),  # 依赖 users 表的 User 模型
    ]
    operations = [
        migrations.RunSQL(
            sql="""
                CREATE TABLE IF NOT EXISTS wechat_users (
                    id BIGSERIAL PRIMARY KEY,
                    user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
                    openid VARCHAR(64) NOT NULL UNIQUE,
                    unionid VARCHAR(64) NULL,
                    nickname VARCHAR(128) NULL,
                    avatar_url VARCHAR(512) NULL,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_wechat_users_openid ON wechat_users(openid);
            """,
            reverse_sql="DROP TABLE IF EXISTS wechat_users;",
        ),
    ]
