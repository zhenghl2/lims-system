"""User serializers."""
from rest_framework import serializers
from django.contrib.auth import authenticate
from .models import User


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField()
    password = serializers.CharField(write_only=True)

    def validate(self, attrs):
        username = attrs.get("username")
        password = attrs.get("password")

        if username and password:
            user = authenticate(
                request=self.context.get("request"),
                username=username,
                password=password,
            )
            if not user:
                raise serializers.ValidationError("Invalid credentials")
            if not user.is_active:
                raise serializers.ValidationError("Account is deactivated")
            attrs["user"] = user
        else:
            raise serializers.ValidationError("Username and password are required")
        return attrs


class UserMeSerializer(serializers.ModelSerializer):
    full_name = serializers.SerializerMethodField()
    roles = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "employee_id", "username", "email", "first_name", "last_name",
                   "full_name", "locale", "timezone", "mfa_enabled",
                   "site_id", "roles", "last_login", "allowed_panels"]
        read_only_fields = fields

    allowed_panels = serializers.SerializerMethodField()

    def get_allowed_panels(self, obj):
        if obj.site and obj.site.allowed_panels:
            return obj.site.allowed_panels
        return []  # empty list = all panels accessible

    def get_full_name(self, obj):
        return f"{obj.first_name} {obj.last_name}"

    def get_roles(self, obj):
        from .models import UserRole
        assignments = UserRole.objects.filter(user=obj, site=obj.site).select_related("role")
        return [{"name": a.role.name, "expires_at": a.expires_at} for a in assignments]


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True, min_length=12)
    confirm_password = serializers.CharField(write_only=True)

    def validate(self, attrs):
        request = self.context.get("request")
        if not request or not request.user.check_password(attrs["current_password"]):
            raise serializers.ValidationError("Current password is incorrect")
        if attrs["new_password"] != attrs["confirm_password"]:
            raise serializers.ValidationError("Passwords do not match")
        if attrs["new_password"] == attrs["current_password"]:
            raise serializers.ValidationError("New password must be different")
        if attrs["new_password"] == request.user.username or attrs["new_password"] == request.user.email:
            raise serializers.ValidationError("Password cannot be your username or email")
        return attrs



class UserListSerializer(serializers.ModelSerializer):
    """Compact user info for dropdowns/selectors (performed_by, etc.)."""
    full_name = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "employee_id", "username", "first_name", "last_name", "full_name"]
        read_only_fields = fields

    allowed_panels = serializers.SerializerMethodField()

    def get_allowed_panels(self, obj):
        if obj.site and obj.site.allowed_panels:
            return obj.site.allowed_panels
        return []  # empty list = all panels accessible

    def get_full_name(self, obj):
        name = f"{obj.first_name} {obj.last_name}".strip()
        return name or obj.username


class UpdateLocaleSerializer(serializers.Serializer):
    locale = serializers.ChoiceField(choices=[
        ("en", "English"),
        ("zh", "中文"),
        ("pt", "Português"),
    ])
