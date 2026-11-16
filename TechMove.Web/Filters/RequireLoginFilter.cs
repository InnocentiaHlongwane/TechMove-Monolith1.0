using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using TechMove.Web.Services;

namespace TechMove.Web.Filters;

/// <summary>
/// The API rejects every request that has no JWT (401), and the API clients swallow that and
/// return empty lists. Send users to the login page first so a token is actually obtained.
/// </summary>
public class RequireLoginFilter : IActionFilter
{
    public void OnActionExecuting(ActionExecutingContext context)
    {
        var controller = context.RouteData.Values["controller"]?.ToString();
        var action = context.RouteData.Values["action"]?.ToString();

        if (string.Equals(controller, "Login", StringComparison.OrdinalIgnoreCase) ||
            (string.Equals(controller, "Home", StringComparison.OrdinalIgnoreCase) &&
             string.Equals(action, "Error", StringComparison.OrdinalIgnoreCase)))
            return;

        var auth = context.HttpContext.RequestServices.GetRequiredService<IAuthenticationService>();
        if (!auth.IsAuthenticated())
            context.Result = new RedirectToActionResult("Index", "Login", null);
    }

    public void OnActionExecuted(ActionExecutedContext context) { }
}
