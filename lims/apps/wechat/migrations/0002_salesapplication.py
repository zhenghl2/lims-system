# 用户管理模块 — 销售注册申请
#
# 背景说明：
#   wechat/0001_initial.py 使用 RunSQL 手写建表，因此 Django 的「模型状态」(state)
#   中从未登记过 WechatUser 模型。本迁移用 SeparateDatabaseAndState 把 WechatUser
#   的模型状态补齐（数据库已有该表，故 database_operations 为空），
#   然后再新建 SalesApplication 真实表。
import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("organizations", "__first__"),
        ("wechat", "0001_initial"),
    ]

    operations = [
        # ① 补齐 WechatUser 的模型状态（表已存在，不动数据库）
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.CreateModel(
                    name="WechatUser",
                    fields=[
                        ("id", models.BigAutoField(auto_created=True, primary_key=True,
                                                   serialize=False, verbose_name="ID")),
                        ("openid", models.CharField(max_length=64, unique=True)),
                        ("unionid", models.CharField(max_length=64, null=True, blank=True)),
                        ("nickname", models.CharField(max_length=128, null=True, blank=True)),
                        ("avatar_url", models.URLField(max_length=512, null=True, blank=True)),
                        ("created_at", models.DateTimeField(auto_now_add=True)),
                        ("user", models.OneToOneField(
                            blank=True, null=True,
                            on_delete=django.db.models.deletion.CASCADE,
                            related_name="wechat_user",
                            to=settings.AUTH_USER_MODEL,
                        )),
                    ],
                    options={
                        "verbose_name": "微信用户",
                        "verbose_name_plural": "微信用户",
                        "db_table": "wechat_users",
                    },
                ),
            ],
            database_operations=[],
        ),
        # ② 放宽 user 可空（DB 层面原本就没有 NOT NULL，此处仅同步状态）
        migrations.AlterField(
            model_name="wechatuser",
            name="user",
            field=models.OneToOneField(
                blank=True, null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="wechat_user",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        # ③ 新建销售申请表
        migrations.CreateModel(
            name="SalesApplication",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False,
                                        primary_key=True, serialize=False)),
                ("code", models.CharField(db_index=True, max_length=32, unique=True,
                                          verbose_name="申请编号")),
                ("openid", models.CharField(db_index=True, max_length=64)),
                ("unionid", models.CharField(blank=True, max_length=64, null=True)),
                ("real_name", models.CharField(max_length=150, verbose_name="姓名")),
                ("phone", models.CharField(db_index=True, max_length=30, verbose_name="手机号")),
                ("status", models.CharField(
                    choices=[("pending", "待审核"), ("approved", "已通过"), ("rejected", "已拒绝")],
                    db_index=True, default="pending", max_length=20)),
                ("reviewer_name", models.CharField(blank=True, max_length=150,
                                                   verbose_name="审核人姓名快照")),
                ("reviewed_at", models.DateTimeField(blank=True, null=True, verbose_name="审核时间")),
                ("reject_reason", models.TextField(blank=True, verbose_name="拒绝原因")),
                ("initial_password_shown_at", models.DateTimeField(
                    blank=True, null=True, verbose_name="初始密码查看时间")),
                ("remark", models.TextField(blank=True, verbose_name="管理员备注")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("created_user", models.ForeignKey(
                    blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                    related_name="source_application", to=settings.AUTH_USER_MODEL,
                    verbose_name="审核通过后创建的账号")),
                ("reviewer", models.ForeignKey(
                    blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                    related_name="reviewed_applications", to=settings.AUTH_USER_MODEL)),
                ("site", models.ForeignKey(
                    on_delete=django.db.models.deletion.PROTECT,
                    related_name="sales_applications", to="organizations.site")),
            ],
            options={
                "verbose_name": "销售注册申请",
                "verbose_name_plural": "销售注册申请",
                "db_table": "wechat_sales_applications",
                "ordering": ["-created_at"],
                "indexes": [
                    models.Index(fields=["status", "-created_at"], name="wechat_sale_status_1e9d4b_idx"),
                    models.Index(fields=["phone"], name="wechat_sale_phone_9a3f21_idx"),
                    models.Index(fields=["openid"], name="wechat_sale_openid_7c2e88_idx"),
                ],
            },
        ),
    ]
