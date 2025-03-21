use std::collections::HashMap;
use evalexpr::{eval_boolean_with_context, ContextWithMutableVariables, EvalexprResult, HashMapContext};
use serde_json::Value;

// 将 serde_json::Value 转换为 evalexpr::Value
pub fn json_value_to_eval_value(value: &Value) -> evalexpr::Value {
    match value {
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                evalexpr::Value::Int(i)
            } else if let Some(f) = n.as_f64() {
                evalexpr::Value::Float(f)
            } else {
                evalexpr::Value::Empty
            }
        }
        Value::String(s) => evalexpr::Value::String(s.clone()),
        Value::Bool(b) => evalexpr::Value::Boolean(*b),
        Value::Null => evalexpr::Value::Empty,
        _ => evalexpr::Value::Empty,
    }
}

pub fn eval_on_flat_hash(flat_map: &HashMap<String, Value>, expr: &str) -> EvalexprResult<bool> {
    let mut context = HashMapContext::new();

    // 将扁平化的 HashMap 转换为 evalexpr 上下文
    for (key, value) in flat_map {
        context.set_value(key.replace(".", "_"), json_value_to_eval_value(value))?;
    }

    // 替换表达式中的点号为下划线
    let modified_expr = expr.replace(".", "_");

    // 执行表达式并返回布尔结果
    eval_boolean_with_context(&modified_expr, &context)
}



#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use crate::flatten::flatten_json;


    #[test]
    fn test_simple_comparison() {
        let input = json!({
            "age": 25,
            "name": "John"
        });

        let mut flat_map = HashMap::new();
        flatten_json(&input, "", &mut flat_map);

        let result = eval_on_flat_hash(&flat_map, "age > 20").unwrap();
        assert!(result);

        let result = eval_on_flat_hash(&flat_map, "age < 20").unwrap();
        assert!(!result);
    }

    #[test]
    fn test_nested_fields() {
        let input = json!({
            "user": {
                "age": 25,
                "profile": {
                    "score": 85
                }
            }
        });

        let mut flat_map = HashMap::new();
        flatten_json(&input, "", &mut flat_map);

        let result = eval_on_flat_hash(&flat_map, "user_age >= 20 && user_profile_score > 80").unwrap();
        assert!(result);
    }

    #[test]
    fn test_array_fields() {
        let input = json!({
            "scores": [85, 90, 95],
            "name": "John"
        });

        let mut flat_map = HashMap::new();
        flatten_json(&input, "", &mut flat_map);

        let result = eval_on_flat_hash(&flat_map, "scores[0] >= 80 && scores[1] >= 90").unwrap();
        assert!(result);
    }

    #[test]
    fn test_string_comparison() {
        let input = json!({
            "user": {
                "name": "John",
                "role": "admin"
            }
        });

        let mut flat_map = HashMap::new();
        flatten_json(&input, "", &mut flat_map);

        let result = eval_on_flat_hash(&flat_map, "user_role == \"admin\"").unwrap();
        assert!(result);
    }

    #[test]
    fn test_complex_expression() {
        let input = json!({
            "user": {
                "age": 25,
                "active": true,
                "scores": [85, 90, 95]
            }
        });

        let mut flat_map = HashMap::new();
        flatten_json(&input, "", &mut flat_map);

        let result = eval_on_flat_hash(&flat_map, "user_age > 20 && user_active && user_scores[0] >= 80").unwrap();
        assert!(result);
    }

    #[test]
    fn test_invalid_expression() {
        let input = json!({
            "age": 25
        });

        let mut flat_map = HashMap::new();
        flatten_json(&input, "", &mut flat_map);

        let result = eval_on_flat_hash(&flat_map, "invalid_field > 20");
        assert!(result.is_err());
    }
}
