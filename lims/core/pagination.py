"""Custom pagination classes for LIMS API."""
from rest_framework.pagination import PageNumberPagination


class StandardResultsSetPagination(PageNumberPagination):
    """Standard pagination with page number."""
    page_size = 50
    page_size_query_param = 'page_size'
    max_page_size = 500


class CursorPagination(PageNumberPagination):
    """Cursor pagination for audit logs (large datasets)."""
    page_size = 100
    page_size_query_param = 'page_size'
    max_page_size = 500
